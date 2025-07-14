const Minio = require('minio');
const crypto = require('crypto');
const path = require('path');
const { GraphQLError } = require('graphql');
const logger = require('../utils/logger');
const SUBDIRECTORY = 'prompthkithustlebot';
require('dotenv').config();

class FileUploadService {
  constructor() {
    this.minioClient = new Minio.Client({
      endPoint: process.env.ENDPOINT,
      port: parseInt(process.env.MINIO_PORT),
      useSSL: true,
      accessKey: process.env.ACCESS_KEY,
      secretKey: process.env.SECRET_KEY,
      region: process.env.REGION
    });
    this.bucketName = process.env.BUCKET_NAME;
    this.defaultSubDirectory = SUBDIRECTORY;
    
    // CDN configuration
    this.cdnConfig = {
      domain: process.env.CDN_DOMAIN || process.env.ENDPOINT,
      enabled: process.env.CDN_ENABLED === 'true' || false
    };
    
    logger.info('FileUploadService initialized with MinIO bucket', { 
      bucketName: this.bucketName,
      cdnEnabled: this.cdnConfig.enabled 
    });
  }

  async verifyMinioConnection() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) {
        throw new GraphQLError(`Bucket '${this.bucketName}' does not exist`, { extensions: { code: 'SERVICE_UNAVAILABLE' } });
      }
      return true;
    } catch (error) {
      logger.error('MinIO Connection Error:', { error });
      throw new GraphQLError(`MinIO Connection Failed: ${error.message}`, { extensions: { code: 'SERVICE_UNAVAILABLE' } });
    }
  }

  async healthCheck() {
    try {
      await this.verifyMinioConnection();
      return {
        service: 'MinIO',
        status: 'healthy',
        bucket: this.bucketName,
        cdnEnabled: this.cdnConfig.enabled
      };
    } catch (error) {
      return {
        service: 'MinIO',
        status: 'unhealthy',
        error: error.message,
      };
    }
  }
  
  generateUniqueFileName(originalName) {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const sanitizedName = path.basename(originalName).replace(/[^a-zA-Z0-9.-]/g, '_');
    const extension = path.extname(sanitizedName).toLowerCase();
    return `${timestamp}-${randomString}${extension}`;
  }

  generateFileUrl(fileName, subDirectory = this.defaultSubDirectory) {
    const domain = this.cdnConfig.enabled ? this.cdnConfig.domain : process.env.ENDPOINT;
    return `https://${domain}/innovative/${subDirectory}/${fileName}`;
  }

  // Helper to convert stream to buffer
  async streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Helper to dynamically import file-type (ESM) in CommonJS context
   */
  async getFileType() {
    if (!this._FileType) {
      this._FileType = await import('file-type');
    }
    return this._FileType;
  }

  /**
   * Validates an image file by checking its actual content (magic bytes) using file-type.
   * Accepts file object with buffer or createReadStream. Throws if invalid.
   */
  async validateImageFile(file, maxSizeMB = 5) {
    let buffer, filename;
  
    // 🧩 Extract buffer and filename
    if (file) {
      if (file.buffer) {
        buffer = file.buffer;
      } else if (typeof file.createReadStream === 'function') {
        buffer = await this.streamToBuffer(file.createReadStream());
      } else {
        throw new GraphQLError('No buffer or stream found in file', {
          extensions: { code: 'INVALID_FILE' }
        });
      }
      filename = file.originalname || file.filename;
    } else {
      throw new GraphQLError('No file provided', {
        extensions: { code: 'NO_FILE_PROVIDED' }
      });
    }
  
    // ✅ Dynamically import file-type module
    const FileTypeModule = await this.getFileType();
    const type = await FileTypeModule.fileTypeFromBuffer(buffer);
  
    // ✅ Only allow known image types
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!type || !allowedTypes.includes(type.mime)) {
      throw new GraphQLError('Invalid file type. Only JPEG, PNG, and WebP are allowed.', {
        extensions: { code: 'INVALID_FILE_TYPE' }
      });
    }
  
    // ✅ Enforce size check
    const maxSize = maxSizeMB * 1024 * 1024;
    if (buffer.length > maxSize) {
      throw new GraphQLError(`File too large. Maximum size is ${maxSizeMB}MB.`, {
        extensions: { code: 'FILE_TOO_LARGE' }
      });
    }
  
    logger.info('✅ Image file validated (magic byte check)', {
      filename,
      detectedType: type.mime,
      size: buffer.length
    });
  
    return true;
  }

  // Accepts buffer, GraphQL Upload, or base64 string
  async uploadFile(file, subDirectory = this.defaultSubDirectory) {
    try {
      await this.verifyMinioConnection();
      // Handle base64 string
      if (typeof file === 'string') {
        const result = await this.uploadBase64Image(file, null, subDirectory);
        return result.url;
      }
      let fileObj = file;
      // Handle GraphQL Upload format
      if (file && typeof file.promise === 'function') {
        fileObj = await file.promise;
      }
      // If file has createReadStream, convert to buffer
      let buffer = fileObj.buffer;
      if (!buffer && typeof fileObj.createReadStream === 'function') {
        buffer = await this.streamToBuffer(fileObj.createReadStream());
      }
      if (!buffer || !fileObj.filename && !fileObj.originalname) {
        throw new GraphQLError('Invalid file object', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      // Validate file content and size before upload
      await this.validateImageFile({ ...fileObj, buffer });
      const originalName = fileObj.originalname || fileObj.filename;
      const fileName = this.generateUniqueFileName(originalName);
      const key = `/${subDirectory}/${fileName}`;
      const metaData = {
        'Content-Type': fileObj.mimetype || 'application/octet-stream',
        'Content-Length': buffer.length,
        'Original-Name': originalName
      };
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          await this.minioClient.putObject(
            this.bucketName,
            key,
            buffer,
            metaData
          );
          break;
        } catch (error) {
          attempts++;
          logger.error(`Upload attempt ${attempts} failed: ${error.message}`);
          if (attempts === maxAttempts) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }
      const fileUrl = this.generateFileUrl(fileName, subDirectory);
      logger.info('File uploaded to MinIO', {
        fileUrl: fileUrl,
        subFileName: key,
        cdnEnabled: this.cdnConfig.enabled
      });
      return fileUrl;
    } catch (error) {
      logger.error('FileUploadService.uploadFile failed', { error });
      throw new GraphQLError('Failed to upload file', { extensions: { code: 'FILE_UPLOAD_FAILED' } });
    }
  }

  // Accepts array of buffers, GraphQL Uploads, or base64 strings
  async uploadFiles(files, subDirectory = this.defaultSubDirectory) {
    if (!Array.isArray(files)) {
      throw new GraphQLError('Files must be an array', { extensions: { code: 'BAD_USER_INPUT' } });
    }
    if (files.length === 0) {
      return [];
    }
    try {
      const uploadPromises = files.map(file => this.uploadFile(file, subDirectory));
      const results = await Promise.all(uploadPromises);
      return results;
    } catch (error) {
      logger.error('Multiple file upload failed', { error });
      throw new GraphQLError('Multiple file upload failed', { extensions: { code: 'FILE_UPLOAD_FAILED' } });
    }
  }

  // Accepts fileUrl (string)
  async deleteFile(fileUrl) {
    try {
      await this.verifyMinioConnection();
      
      // Extract key from URL
      let key;
      if (fileUrl.includes('.com/')) {
        key = fileUrl.split('.com/')[1];
      } else if (fileUrl.includes('.net/')) {
        key = fileUrl.split('.net/')[1];
      } else if (fileUrl.includes('.org/')) {
        key = fileUrl.split('.org/')[1];
      } else if (fileUrl.includes(process.env.ENDPOINT + '/')) {
        key = fileUrl.split(process.env.ENDPOINT + '/')[1];
      }
      
      if (!key) {
        logger.warn('Invalid MinIO file URL', { fileUrl });
        throw new GraphQLError('Invalid MinIO file URL', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      
      // Remove leading slash if present
      const objectKey = key.replace(new RegExp(`^/?${this.bucketName}/`), '');   
      console.log("objectKey" , objectKey)   
      // Check if file exists before deletion
      try {
        await this.minioClient.statObject(this.bucketName , objectKey);
      } catch (error) {
        if (error.code === 'NotFound') {
          logger.warn('File not found for deletion', { fileUrl, objectKey });
          throw new GraphQLError('File not found', { extensions: { code: 'FILE_NOT_FOUND' } });
        }
        throw error;
      }
      
      await this.minioClient.removeObject(this.bucketName, objectKey);
      logger.info('File deleted from MinIO', { fileUrl, objectKey });
      return true;
    } catch (error) {
      logger.error('FileUploadService.deleteFile failed', { error });
      throw new GraphQLError('Failed to delete file', { extensions: { code: 'FILE_DELETE_FAILED' } });
    }
  }

  // List all files in the bucket/subdirectory
  async listFiles(subDirectory = this.defaultSubDirectory) {
    try {
      await this.verifyMinioConnection();
      const files = [];
      const prefix = subDirectory ? `${subDirectory}/` : '';
      const stream = this.minioClient.listObjects(this.bucketName, prefix, true);
      return await new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          const fileName = obj.name.split('/').pop();
          files.push({
            name: obj.name,
            filename: fileName,
            size: obj.size,
            lastModified: obj.lastModified,
            url: this.generateFileUrl(fileName, subDirectory),
            cdnEnabled: this.cdnConfig.enabled,
            subDirectory: subDirectory
          });
        });
        stream.on('error', (err) => {
          reject(new GraphQLError(`Error listing files: ${err.message}`, { extensions: { code: 'FILE_LIST_FAILED' } }));
        });
        stream.on('end', () => {
          resolve(files);
        });
      });
    } catch (error) {
      logger.error('Error listing files', { error });
      throw new GraphQLError('File listing failed', { extensions: { code: 'FILE_LIST_FAILED' } });
    }
  }

  // --- Base64 image helpers ---
  processBase64Image(base64String, filename = null) {
    try {
      const base64Data = base64String.replace(/^data:image\/[a-z]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      let extension = '.png';
      let mimetype = 'image/png';
      if (buffer.length >= 4) {
        const header = buffer.subarray(0, 4);
        if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
          extension = '.png';
          mimetype = 'image/png';
        } else if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
          extension = '.jpg';
          mimetype = 'image/jpeg';
        } else if (buffer.length >= 12 &&
          header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
          buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
          extension = '.webp';
          mimetype = 'image/webp';
        } else if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
          extension = '.gif';
          mimetype = 'image/gif';
        }
      }
      const finalFilename = filename || `ai-generated-image${extension}`;
      return {
        buffer,
        mimetype,
        extension,
        originalname: finalFilename,
        size: buffer.length
      };
    } catch (error) {
      throw new GraphQLError(`Failed to process base64 image: ${error.message}`, { extensions: { code: 'BAD_USER_INPUT' } });
    }
  }

  async uploadBase64Image(base64String, filename = null, subDirectory = this.defaultSubDirectory) {
    try {
      await this.verifyMinioConnection();
      const imageData = this.processBase64Image(base64String, filename);
      const uniqueFileName = this.generateUniqueFileName(imageData.originalname);
      const metaData = {
        'Content-Type': imageData.mimetype,
        'Content-Length': imageData.size,
        'Original-Name': imageData.originalname,
        'Upload-Source': 'AI-Generated'
      };
      let attempts = 0;
      const maxAttempts = 3;
      const key = `/${subDirectory}/${uniqueFileName}`;
      while (attempts < maxAttempts) {
        try {
          await this.minioClient.putObject(
            this.bucketName,
            key,
            imageData.buffer,
            metaData
          );
          break;
        } catch (error) {
          attempts++;
          logger.error(`Upload attempt ${attempts} failed: ${error.message}`);
          if (attempts === maxAttempts) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }
      const fileUrl = this.generateFileUrl(uniqueFileName, subDirectory);
      logger.info('Base64 image uploaded to MinIO', {
        fileUrl: fileUrl,
        subFileName: key,
        cdnEnabled: this.cdnConfig.enabled
      });
      return {
        url: fileUrl,
        filename: uniqueFileName,
        originalName: imageData.originalname,
        size: imageData.size,
        mimetype: imageData.mimetype,
        cdnEnabled: this.cdnConfig.enabled,
        subDirectory: subDirectory
      };
    } catch (error) {
      logger.error('Error uploading base64 image', { error });
      throw new GraphQLError(`Base64 image upload failed: ${error.message}`, { extensions: { code: 'FILE_UPLOAD_FAILED' } });
    }
  }

  async uploadMultipleBase64Images(base64Images, subDirectory = this.defaultSubDirectory) {
    if (!Array.isArray(base64Images)) {
      throw new GraphQLError('Base64 images must be an array', { extensions: { code: 'BAD_USER_INPUT' } });
    }
    if (base64Images.length === 0) {
      return [];
    }
    try {
      const uploadPromises = base64Images.map((imageData, index) => {
        if (typeof imageData === 'string') {
          return this.uploadBase64Image(imageData, `ai-image-${index + 1}.png`, subDirectory);
        } else if (typeof imageData === 'object' && imageData.base64) {
          return this.uploadBase64Image(imageData.base64, imageData.filename, subDirectory);
        } else {
          throw new GraphQLError(`Invalid image data format at index ${index}`, { extensions: { code: 'BAD_USER_INPUT' } });
        }
      });
      const results = await Promise.all(uploadPromises);
      return results;
    } catch (error) {
      logger.error('Multiple base64 image upload failed', { error });
      throw new GraphQLError(`Multiple base64 image upload failed: ${error.message}`, { extensions: { code: 'FILE_UPLOAD_FAILED' } });
    }
  }
}

module.exports = new FileUploadService();