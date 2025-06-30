# DigitalOcean Spaces Setup

This document explains how to configure DigitalOcean Spaces for file uploads in Xplore-Pulse.

## Environment Variables

Add these environment variables to your `.env` file:

```env
# DigitalOcean Spaces Configuration
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_REGION=nyc3
DO_SPACES_ACCESS_KEY=your_access_key_here
DO_SPACES_SECRET_KEY=your_secret_key_here
DO_SPACES_BUCKET_NAME=your_bucket_name

# CDN Configuration (Optional)
CDN_DOMAIN=your-cdn-domain.com
CDN_ENABLED=true
```

## Getting DigitalOcean Spaces Credentials

1. **Create a DigitalOcean Account**: Sign up at [digitalocean.com](https://digitalocean.com)

2. **Create a Space**:
   - Go to DigitalOcean Dashboard
   - Navigate to "Spaces" in the left sidebar
   - Click "Create a Space"
   - Choose a region (e.g., NYC3)
   - Choose a name for your space
   - Set file listing to "Public" or "Private" based on your needs

3. **Generate API Keys**:
   - Go to "API" in the left sidebar
   - Click "Generate New Token"
   - Give it a name (e.g., "Xplore-Pulse Spaces")
   - Copy the generated token (this is your `DO_SPACES_SECRET_KEY`)
   - The access key will be shown in the Spaces settings

4. **Configure CORS** (if needed):
   - In your Space settings, go to "Settings" tab
   - Add CORS rules if you need to upload directly from browser

## CDN Setup (Optional)

For better performance, you can enable CDN:

1. **Enable CDN in your Space**:
   - Go to your Space settings
   - Enable CDN
   - Note the CDN endpoint URL

2. **Update Environment Variables**:
   ```env
   CDN_DOMAIN=your-space-name.nyc3.cdn.digitaloceanspaces.com
   CDN_ENABLED=true
   ```

## Migration from MinIO

If you're migrating from MinIO, update your environment variables:

### Old MinIO Variables:
```env
ENDPOINT=your-minio-endpoint
MINIO_PORT=9000
ACCESS_KEY=your-minio-access-key
SECRET_KEY=your-minio-secret-key
REGION=us-east-1
BUCKET_NAME=your-bucket-name
```

### New DigitalOcean Spaces Variables:
```env
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_REGION=nyc3
DO_SPACES_ACCESS_KEY=your-do-access-key
DO_SPACES_SECRET_KEY=your-do-secret-key
DO_SPACES_BUCKET_NAME=your-space-name
```

## Features

The updated FileUploadService includes:

- ✅ **S3-Compatible API**: Uses AWS SDK v3 for S3 operations
- ✅ **CDN Support**: Optional CDN integration for better performance
- ✅ **Retry Mechanism**: Automatic retry on upload failures
- ✅ **File Validation**: Image type and size validation
- ✅ **Error Handling**: Comprehensive error messages
- ✅ **File Management**: Upload, delete, and list files
- ✅ **Backward Compatibility**: Same interface as MinIO version

## Usage Examples

### Upload a Single File
```javascript
const fileUploadService = require('./services/fileUploadService');

const result = await fileUploadService.uploadFile(file, 'profile-images');
// Returns: https://your-space.nyc3.digitaloceanspaces.com/profile-images/filename.jpg
```

### Upload Multiple Files
```javascript
const results = await fileUploadService.uploadFiles(files, 'gallery');
// Returns array of URLs
```

### Delete a File
```javascript
await fileUploadService.deleteFile(fileUrl);
```

### List Files
```javascript
const files = await fileUploadService.listFiles('profile-images');
```

## Security Considerations

1. **Access Control**: Set appropriate ACLs for your files
2. **CORS Configuration**: Configure CORS rules if uploading from browser
3. **API Key Security**: Keep your API keys secure and rotate them regularly
4. **Bucket Permissions**: Ensure your bucket has the right permissions

## Troubleshooting

### Common Issues

1. **"Bucket does not exist"**:
   - Check your `DO_SPACES_BUCKET_NAME` environment variable
   - Ensure the space exists in your DigitalOcean account

2. **"Access denied"**:
   - Verify your `DO_SPACES_ACCESS_KEY` and `DO_SPACES_SECRET_KEY`
   - Check if your API token has the right permissions

3. **"Connection failed"**:
   - Verify your `DO_SPACES_ENDPOINT` and `DO_SPACES_REGION`
   - Check your internet connection

4. **CDN not working**:
   - Ensure CDN is enabled in your Space settings
   - Check your `CDN_DOMAIN` environment variable 