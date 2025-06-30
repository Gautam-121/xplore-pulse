# GraphQL Playground Sample Queries

## 1. Send OTP for Signup
```graphql
mutation SendOTP {
  sendOTP(input: {
    phoneNumber: "1234567890"
    countryCode: "+1"
    type: SIGNUP
  }) {
    success
    message
    otpExpiresAt
    retryAfter
  }
}
```

## 2. Verify OTP and Login/Signup
```graphql
mutation VerifyOTP {
  verifyOTP(input: {
    phoneNumber: "1234567890"
    countryCode: "+1"
    otp: "123456"
    deviceInfo: {
      deviceId: "device-123"
      deviceType: "iOS"
      appVersion: "1.0.0"
      osVersion: "17.0"
      fcmToken: "fcm-token-123"
    }
  }) {
    success
    message
    isNewUser
    user {
      id
      phoneNumber
      name
      onboardingStep
      isProfileComplete
    }
    authTokens {
      accessToken
      refreshToken
      expiresAt
    }
  }
}
```

## 3. Complete Profile Setup (requires authentication)
```graphql
mutation CompleteProfile {
  completeProfileSetup(input: {
    name: "John Doe"
    email: "john@example.com"
    bio: "Software developer passionate about technology"
  }) {
    success
    message
    user {
      id
      name
      email
      bio
      onboardingStep
      isProfileComplete
    }
  }
}
```

## 4. Get Available Interests
```graphql
query GetInterests {
  interests {
    id
    name
    slug
    description
    iconUrl
    colorHex
    category
    isPopular
    followersCount
  }
}
```

## 5. Select User Interests
```graphql
mutation SelectInterests {
  selectInterests(interestIds: [
    "interest-1-id"
    "interest-2-id"
    "interest-3-id"
  ]) {
    success
    message
    user {
      id
      interests {
        id
        name
        category
      }
      onboardingStep
    }
    recommendedCommunities {
      id
      name
      description
      memberCount
    }
  }
}
```

## 6. Get Current User Profile
```graphql
query GetCurrentUser {
  currentUser {
    id
    phoneNumber
    countryCode
    name
    email
    bio
    profileImageUrl
    isVerified
    isActive
    isProfileComplete
    onboardingStep
    notificationSettings {
      pushNotifications
      emailNotifications
      communityUpdates
      eventReminders
    }
    privacySettings {
      profileVisibility
      showEmail
      showPhoneNumber
    }
    interests {
      id
      name
      iconUrl
      category
    }
    followersCount
    followingCount
    postsCount
    eventsCount
    createdAt
    lastActiveAt
  }
}
```

## 7. Search Users
```graphql
query SearchUsers {
  searchUsers(query: "john", limit: 10, offset: 0) {
    users {
      id
      name
      bio
      profileImageUrl
      isVerified
      followersCount
      interests {
        id
        name
      }
    }
    totalCount
    hasMore
  }
}
```

## 8. Update Profile
```graphql
mutation UpdateProfile {
  updateUserProfile(input: {
    name: "John Doe Updated"
    bio: "Updated bio description"
  }) {
    success
    message
    user {
      id
      name
      bio
      updatedAt
    }
  }
} 