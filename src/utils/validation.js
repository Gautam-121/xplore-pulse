const { GraphQLError } = require('graphql');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { currency } = require("../utils/constant")
const validator = require('validator');

class ValidationService {
  // ---------- SANITIZERS ----------

  static sanitizeEmail(email) {
    return validator.trim(email || '').toLowerCase() || null;
  }

  static sanitizePhoneNumber(phoneNumber) {
    return validator.whitelist(phoneNumber || '', '0-9') || null;
  }

  static sanitizeCountryCode(countryCode) {
    return validator.trim(countryCode || '') || null;
  }

  static sanitizeName(name) {
    return validator.trim(name || '') || null;
  }

  static sanitizeBio(bio) {
    return validator.trim(bio || '') || null;
  }

  static sanitizeUsername(username) {
    return validator.trim(username || '').toLowerCase();
  }

  static sanitizePassword(password) {
    return password?.trim() || null;
  }

  static sanitizeUUID(id) {
    return validator.trim(id || '') || null;
  }

  static sanitizeOTP(otp) {
    return validator.trim(String(otp || ''));
  }

  static sanitizeDeviceInfo(deviceInfo) {
    if (!deviceInfo || typeof deviceInfo !== 'object') return {};

    return {
      appVersion: deviceInfo.appVersion?.trim(),
      deviceId: deviceInfo.deviceId?.trim(),
      deviceName: deviceInfo.deviceName?.trim(),
      deviceType: deviceInfo.deviceType?.trim(),
      osVersion: deviceInfo.osVersion?.trim(),
    };
  }

  static sanitizeArrayUUID(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(id => this.sanitizeUUID(id));
  }
  
  // ---------- VALIDATORS ----------

  static validateEmail(email) {
    const sanitized = this.sanitizeEmail(email);
    if (!sanitized) return true;
    if (!validator.isEmail(sanitized)) {
      throw new GraphQLError('Invalid email format.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'email' }
      });
    }
    return true;
  }

  static validatePhoneNumber(phoneNumber, countryCode) {
    const sanitizedPhone = this.sanitizePhoneNumber(phoneNumber);
    const sanitizedCountryCode = this.sanitizeCountryCode(countryCode);

    if (!sanitizedPhone || !sanitizedCountryCode) {
      throw new GraphQLError('Phone number and country code are required.', {
        extensions: { code: 'BAD_USER_INPUT' }
      });
    }

    if (!/^\+\d{1,4}$/.test(sanitizedCountryCode)) {
      throw new GraphQLError(
        'Invalid country code. Must start with "+" followed by 1 to 4 digits.',
        { extensions: { code: 'BAD_USER_INPUT', field: 'countryCode' } }
      );
    }

    if (!validator.isLength(sanitizedPhone, { min: 6, max: 15 })) {
      throw new GraphQLError(
        'Phone number must be between 6 and 15 digits.',
        { extensions: { code: 'BAD_USER_INPUT', field: 'phoneNumber' } }
      );
    }

    try {
      const fullNumber = `${sanitizedCountryCode}${sanitizedPhone}`;
      const phoneObj = parsePhoneNumberFromString(fullNumber);

      if (!phoneObj || !phoneObj.isValid()) {
        throw new GraphQLError(
          'The phone number is not valid for the provided country code.',
          { extensions: { code: 'BAD_USER_INPUT', field: 'phoneNumber' } }
        );
      }

      const detectedCode = `+${phoneObj.countryCallingCode}`;
      if (detectedCode !== sanitizedCountryCode) {
        throw new GraphQLError(
          `Mismatch between phone and country code. Expected prefix: ${detectedCode}.`,
          { extensions: { code: 'BAD_USER_INPUT', field: 'phoneNumber' } }
        );
      }

      return true;
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      throw new GraphQLError(
        'Unable to validate phone number. Please check the format and try again.',
        { extensions: { code: 'BAD_USER_INPUT', field: 'phoneNumber' } }
      );
    }
  }

  static validateName(name) {
    const sanitized = this.sanitizeName(name);
    if (!sanitized || sanitized.length < 2) {
      throw new GraphQLError('Name must be at least 2 characters long.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'name' }
      });
    }
    if (sanitized.length > 100) {
      throw new GraphQLError('Name must be less than 100 characters.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'name' }
      });
    }
    return true;
  }

  static validateBio(bio , field="bio") {
    const sanitized = this.sanitizeBio(bio);
    if (!sanitized) return true;
    if (sanitized.length > 500) {
      throw new GraphQLError(`${field} must be less than 500 characters.`, {
        extensions: { code: 'BAD_USER_INPUT', field: 'bio' }
      });
    }
    return true;
  }

  static validateOTP(otp) {
    const sanitized = this.sanitizeOTP(otp);
    if (!/^\d{6}$/.test(sanitized)) {
      throw new GraphQLError('OTP must be a 6-digit number.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'otp' }
      });
    }
    return true;
  }

  static validateUsername(username) {
    const sanitized = this.sanitizeUsername(username);
    if (!validator.isLength(sanitized, { min: 3, max: 30 })) {
      throw new GraphQLError('Username must be 3 to 30 characters long.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'username' }
      });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(sanitized)) {
      throw new GraphQLError(
        'Username can only contain letters, numbers, underscores, dots, and hyphens.',
        { extensions: { code: 'BAD_USER_INPUT', field: 'username' } }
      );
    }
    return true;
  }

  static validatePassword(password) {
    const sanitized = this.sanitizePassword(password);
    if (!sanitized || sanitized.length < 8) {
      throw new GraphQLError('Password must be at least 8 characters.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'password' }
      });
    }
    return true;
  }

  static validateUUID(id, field = 'id') {
    const sanitized = this.sanitizeUUID(id);
    if (!validator.isUUID(sanitized)) {
      throw new GraphQLError(`${field} must be valid UUID`, {
        extensions: { code: 'BAD_USER_INPUT', field }
      });
    }
    return true;
  }

  static validateEnum(value, allowed, field) {
    if (!allowed.includes(value)) {
      throw new GraphQLError(`Invalid value for ${field}.`, {
        extensions: { code: 'BAD_USER_INPUT', field }
      });
    }
    return true;
  }

  static validateArrayOfUUIDs(arr, field = 'ids') {
    if (!Array.isArray(arr)) {
      throw new GraphQLError(`${field} Must be an array of UUIDs.`, {
        extensions: { code: 'BAD_USER_INPUT', field }
      });
    }
    arr.forEach(id => this.validateUUID(id, field));
    return true;
  }

  static validatePagination(limit, offset) {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      throw new GraphQLError('Limit must be between 1 and 100.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'limit' }
      });
    }
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
      throw new GraphQLError('Offset must be 0 or greater.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'offset' }
      });
    }
    return true;
  }

  static validateDeviceInfo(rawDeviceInfo) {
    const deviceInfo = this.sanitizeDeviceInfo(rawDeviceInfo);

    const {
      appVersion,
      deviceId,
      deviceName,
      deviceType,
      osVersion
    } = deviceInfo;

    if (!appVersion || !deviceId || !deviceName || !deviceType || !osVersion) {
      throw new GraphQLError('All fields in deviceInfo are required.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'deviceInfo' }
      });
    }

    if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+)?$/.test(appVersion)) {
      throw new GraphQLError('Invalid app version format (e.g., 1.2.3)', {
        extensions: { code: 'BAD_USER_INPUT', field: 'deviceInfo.appVersion' }
      });
    }

    const isValidDeviceId = validator.isUUID(deviceId)
    if (!isValidDeviceId) {
      throw new GraphQLError('deviceId must be a UUID or alphanumeric string', {
        extensions: { code: 'BAD_USER_INPUT', field: 'deviceInfo.deviceId' }
      });
    }

    if (!validator.isLength(deviceName, { min: 2, max: 100 })) {
      throw new GraphQLError('deviceName must be 2–100 characters long', {
        extensions: { code: 'BAD_USER_INPUT', field: 'deviceInfo.deviceName' }
      });
    }

    const allowedTypes = ['Android', 'iOS', 'Web'];
    if (!allowedTypes.includes(deviceType)) {
      throw new GraphQLError(`deviceType must be one of: ${allowedTypes.join(', ')}`, {
        extensions: { code: 'BAD_USER_INPUT', field: 'deviceInfo.deviceType' }
      });
    }

    if (!/^\d+(\.\d+){1,2}$/.test(osVersion)) {
      throw new GraphQLError('Invalid OS version format (e.g., 14.0 or 13.1.2)', {
        extensions: { code: 'BAD_USER_INPUT', field: 'deviceInfo.osVersion' }
      });
    }

    return true;
  }

  static validateFCMToken(token) {
    if (typeof token !== 'string' || token.length < 10 || token.length > 512) {
      throw new GraphQLError('Invalid FCM token provided', {
        extensions: { code: 'INVALID_FCM_TOKEN' },
      });
    }
  }

  static validateLatitude(lat) {
    if (typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90) {
      throw new GraphQLError('Latitude must be a number between -90 and 90.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'latitude' }
      });
    }
    return true;
  }

  static validateLongitude(lng) {
    if (typeof lng !== 'number' || Number.isNaN(lng) || lng < -180 || lng > 180) {
      throw new GraphQLError('Longitude must be a number between -180 and 180.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'longitude' }
      });
    }
    return true;
  }

  static validatePrice(price){
    if(!price || price <= 0){
      throw new GraphQLError('Price must be greater than 0 for paid communities', {
        extensions: { code: 'INVALID_INPUT', field: 'price' }
    });
    }
  }

  static validateCurrency(inputCurrency) {
    if (!currency || !currency.includes(inputCurrency)) {
      throw new GraphQLError('Invalid or missing currency. Please provide a valid currency code', {
        extensions: { code: 'INVALID_INPUT', field: 'currency' }
      });
    }
    return true;
  }

  static validateImageUrl(url, field = 'imageUrl') {
    if (url && !validator.isURL(url, { protocols: ['http','https'], require_protocol: true })) {
      throw new GraphQLError(`Invalid URL for ${field}.`, {
        extensions: { code: 'BAD_USER_INPUT', field }
      });
    }
    return true;
  }

  // ---------- INTEREST VALIDATION ----------

  static validateCreateInterestInput(input) {
    if (!input || typeof input !== 'object') {
      throw new GraphQLError('Input is required for creating an interest.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'input' }
      });
    }
    const { name, slug, description, iconUrl, colorHex, category, sortOrder } = input;

    // name: required, 2-100 chars
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      throw new GraphQLError('Name is required and must be 2-100 characters.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'name' }
      });
    }
    // slug: required, 2-50 chars, URL-friendly
    if (!slug || typeof slug !== 'string' || slug.trim().length < 2 || slug.trim().length > 50) {
      throw new GraphQLError('Slug is required and must be 2-50 characters.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'slug' }
      });
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(slug.trim())) {
      throw new GraphQLError(`Slug of ${slug.trim()} must be URL-friendly (lowercase letters, numbers, hyphens).`, {
        extensions: { code: 'BAD_USER_INPUT', field: 'slug' }
      });
    }
    // description: optional, max 500 chars
    if (description && (typeof description !== 'string' || description.length > 500)) {
      throw new GraphQLError('Description must be less than 500 characters.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'description' }
      });
    }
    // iconUrl: optional, must be valid URL
    this.validateImageUrl(iconUrl, 'iconUrl');
    // colorHex: optional, must be valid hex
    if (colorHex && !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
      throw new GraphQLError('colorHex must be a valid hex color (e.g., #AABBCC)', {
        extensions: { code: 'BAD_USER_INPUT', field: 'colorHex' }
      });
    }
    // category: required, must be valid enum
    const allowedCategories = [
      'TECHNOLOGY','TRAVEL','SCIENCE','HEALTH_FITNESS','BUSINESS','ARTS_CULTURE','FOOD_DRINK','SPORTS','EDUCATION','LIFESTYLE','MUSIC','GAMING','FASHION','PHOTOGRAPHY'
    ];
    if (!category || !allowedCategories.includes(category)) {
      throw new GraphQLError('Category is required and must be a valid InterestCategory.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'category' }
      });
    }
    // sortOrder: optional, must be integer >= 0
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0)) {
      throw new GraphQLError('sortOrder must be a non-negative integer.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'sortOrder' }
      });
    }
    return true;
  }

  static validateBulkCreateInterestInputs(inputs) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new GraphQLError('At least one input is required for bulk creation.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'inputs' }
      });
    }
    // Check for duplicate names or slugs in the input array (case-insensitive)
    const nameSet = new Set();
    const slugSet = new Set();
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      this.validateCreateInterestInput(input);
      const name = input.name.trim().toLowerCase();
      const slug = input.slug.trim().toLowerCase();
      if (nameSet.has(name)) {
        throw new GraphQLError(`Duplicate name '${input.name}' in input array.`, {
          extensions: { code: 'DUPLICATE_INPUT', field: 'name', index: i }
        });
      }
      if (slugSet.has(slug)) {
        throw new GraphQLError(`Duplicate slug '${input.slug}' in input array.`, {
          extensions: { code: 'DUPLICATE_INPUT', field: 'slug', index: i }
        });
      }
      nameSet.add(name);
      slugSet.add(slug);
    }
    return true;
  }

  static validateInterestQueryParams({ query, category, popular, first, after }) {
    // query: optional, string, max 100 chars
    if (query && (typeof query !== 'string' || query.length > 100)) {
      throw new GraphQLError('Query must be a string up to 100 characters.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'query' }
      });
    }
    // category: optional, must be valid enum
    if (category) {
      const allowedCategories = [
        'TECHNOLOGY','TRAVEL','SCIENCE','HEALTH_FITNESS','BUSINESS','ARTS_CULTURE','FOOD_DRINK','SPORTS','EDUCATION','LIFESTYLE','MUSIC','GAMING','FASHION','PHOTOGRAPHY'
      ];
      if (!allowedCategories.includes(category)) {
        throw new GraphQLError('Category must be a valid InterestCategory.', {
          extensions: { code: 'BAD_USER_INPUT', field: 'category' }
        });
      }
    }
    // popular: optional, must be boolean
    if (popular !== undefined && typeof popular !== 'boolean') {
      throw new GraphQLError('Popular must be a boolean.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'popular' }
      });
    }
    // first: optional, must be integer 1-100
    if (first !== undefined && (!Number.isInteger(first) || first < 1 || first > 100)) {
      throw new GraphQLError('first must be an integer between 1 and 100.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'first' }
      });
    }
    // after: optional, must be string (cursor)
    if (after !== undefined && typeof after !== 'string') {
      throw new GraphQLError('after must be a string cursor.', {
        extensions: { code: 'BAD_USER_INPUT', field: 'after' }
      });
    }
    return true;
  }
}

module.exports = ValidationService;
