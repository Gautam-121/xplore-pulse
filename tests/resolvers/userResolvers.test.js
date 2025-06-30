const { gql } = require('apollo-server-express');
const { createTestClient } = require('apollo-server-testing');
const { ApolloServer } = require('apollo-server-express');
const typeDefs = require('../../schema/typeDefs');
const userResolvers = require('../../resolvers/userResolvers');

describe('User Resolvers', () => {
  let server, query, mutate;

  beforeAll(() => {
    server = new ApolloServer({
      typeDefs,
      resolvers: [userResolvers],
      context: () => ({
        user: null,
        loaders: {}
      })
    });

    const testClient = createTestClient(server);
    query = testClient.query;
    mutate = testClient.mutate;
  });

  describe('sendOTP', () => {
    const SEND_OTP_MUTATION = gql`
      mutation SendOTP($input: SendOTPInput!) {
        sendOTP(input: $input) {
          success
          message
          otpExpiresAt
        }
      }
    `;

    it('should send OTP successfully for valid phone number', async () => {
      const result = await mutate({
        mutation: SEND_OTP_MUTATION,
        variables: {
          input: {
            phoneNumber: '1234567890',
            countryCode: '+1',
            type: 'SIGNUP'
          }
        }
      });

      expect(result.errors).toBeUndefined();
      expect(result.data.sendOTP.success).toBe(true);
      expect(result.data.sendOTP.message).toBe('OTP sent successfully');
    });

    it('should fail for invalid phone number', async () => {
      const result = await mutate({
        mutation: SEND_OTP_MUTATION,
        variables: {
          input: {
            phoneNumber: '123',
            countryCode: '+1',
            type: 'SIGNUP'
          }
        }
      });

      expect(result.errors).toBeDefined();
      expect(result.errors[0].extensions.code).toBe('INVALID_PHONE_NUMBER');
    });
  });

  describe('verifyOTP', () => {
    // Add tests for OTP verification
  });

  describe('currentUser', () => {
    // Add tests for authenticated queries
  });
}); 