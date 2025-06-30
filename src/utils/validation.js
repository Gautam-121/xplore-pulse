const { GraphQLError } = require('graphql');

class ValidationService {
  static validatePhoneNumber(phoneNumber, countryCode) {
    // Remove any non-digit characters
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      throw new GraphQLError('Invalid phone number format', { extensions: { code: 'BAD_USER_INPUT', field: 'phoneNumber' } });
    }
    if (!countryCode || countryCode.length > 5) {
      throw new GraphQLError('Invalid country code', { extensions: { code: 'BAD_USER_INPUT', field: 'countryCode' } });
    }
    return true;
  }
  static validateEmail(email) {
    if (!email) return true; // Email is optional
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new GraphQLError('Invalid email format', { extensions: { code: 'BAD_USER_INPUT', field: 'email' } });
    }
    return true;
  }
  static validateName(name) {
    if (!name || name.trim().length < 2) {
      throw new GraphQLError('Name must be at least 2 characters long', { extensions: { code: 'BAD_USER_INPUT', field: 'name' } });
    }
    if (name.length > 100) {
      throw new GraphQLError('Name must be less than 100 characters', { extensions: { code: 'BAD_USER_INPUT', field: 'name' } });
    }
    return true;
  }
  static validateBio(bio) {
    if (!bio) return true; // Bio is optional
    if (bio.length > 500) {
      throw new GraphQLError('Bio must be less than 500 characters', { extensions: { code: 'BAD_USER_INPUT', field: 'bio' } });
    }
    return true;
  }
  static validateOTP(otp) {
    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      throw new GraphQLError('OTP must be 6 digits', { extensions: { code: 'BAD_USER_INPUT', field: 'otp' } });
    }
    return true;
  }
  static validateUsername(username) {
    if (!username || username.length < 3 || username.length > 30) {
      throw new GraphQLError('Username must be 3-30 characters', { extensions: { code: 'BAD_USER_INPUT', field: 'username' } });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      throw new GraphQLError('Username can only contain letters, numbers, underscores, dots, and hyphens', { extensions: { code: 'BAD_USER_INPUT', field: 'username' } });
    }
    return true;
  }
  static validatePassword(password) {
    if (!password || password.length < 8) {
      throw new GraphQLError('Password must be at least 8 characters', { extensions: { code: 'BAD_USER_INPUT', field: 'password' } });
    }
    // At least one uppercase, one lowercase, one number
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      throw new GraphQLError('Password must contain uppercase, lowercase, and a number', { extensions: { code: 'BAD_USER_INPUT', field: 'password' } });
    }
    return true;
  }
  static validateUUID(id, field = 'id') {
    if (!id || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(id)) {
      throw new GraphQLError('Invalid UUID', { extensions: { code: 'BAD_USER_INPUT', field } });
    }
    return true;
  }
  static validateEnum(value, allowed, field) {
    if (!allowed.includes(value)) {
      throw new GraphQLError(`Invalid value for ${field}`, { extensions: { code: 'BAD_USER_INPUT', field } });
    }
    return true;
  }
  static validateArrayOfUUIDs(arr, field = 'ids') {
    if (!Array.isArray(arr)) {
      throw new GraphQLError('Must be an array', { extensions: { code: 'BAD_USER_INPUT', field } });
    }
    arr.forEach(id => this.validateUUID(id, field));
    return true;
  }
  static validatePagination(limit, offset) {
    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
      throw new GraphQLError('Limit must be between 1 and 100', { extensions: { code: 'BAD_USER_INPUT', field: 'limit' } });
    }
    if (offset !== undefined && (isNaN(offset) || offset < 0)) {
      throw new GraphQLError('Offset must be 0 or greater', { extensions: { code: 'BAD_USER_INPUT', field: 'offset' } });
    }
    return true;
  }
}

module.exports = ValidationService; 