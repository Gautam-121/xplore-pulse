# Active Sessions Feature

This feature allows users to view all their active login sessions across different devices and manage them.

## GraphQL Query

### Get Active Sessions
```graphql
query GetActiveSessions {
  activeSessions {
    success
    sessions {
      id
      deviceId
      deviceType
      deviceName
      appVersion
      osVersion
      ipAddress
      userAgent
      lastUsedAt
      tokenExpiresAt
      refreshExpiresAt
      isCurrentSession
    }
    totalCount
  }
}
```

## Example Response

```json
{
  "data": {
    "activeSessions": {
      "success": true,
      "sessions": [
        {
          "id": "session-uuid-1",
          "deviceId": "iphone-123",
          "deviceType": "iOS",
          "deviceName": "iPhone/iPad",
          "appVersion": "1.0.0",
          "osVersion": "iOS 15.0",
          "ipAddress": "192.168.1.100",
          "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
          "lastUsedAt": "2024-01-15T10:30:00Z",
          "tokenExpiresAt": "2024-01-15T11:30:00Z",
          "refreshExpiresAt": "2024-02-14T10:30:00Z",
          "isCurrentSession": true
        },
        {
          "id": "session-uuid-2",
          "deviceId": "chrome-desktop",
          "deviceType": "Web",
          "deviceName": "Chrome Browser",
          "appVersion": "1.0.0",
          "osVersion": "Windows 11",
          "ipAddress": "192.168.1.101",
          "userAgent": "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36",
          "lastUsedAt": "2024-01-15T09:15:00Z",
          "tokenExpiresAt": "2024-01-15T10:15:00Z",
          "refreshExpiresAt": "2024-02-14T09:15:00Z",
          "isCurrentSession": false
        }
      ],
      "totalCount": 2
    }
  }
}
```

## Logout from Specific Device

```graphql
mutation LogoutFromDevice($deviceId: String!) {
  logout(deviceId: $deviceId) {
    success
    message
  }
}
```

## Logout from All Other Devices

```graphql
mutation LogoutFromAllOtherDevices {
  logout(allDevices: true) {
    success
    message
  }
}
```

## Features

1. **Session Information**: Shows device type, name, app version, OS version
2. **Location Tracking**: Displays IP address for security awareness
3. **Current Session**: Identifies which session is currently active
4. **Last Activity**: Shows when each session was last used
5. **Expiration Times**: Displays when tokens will expire
6. **Device Management**: Allows logging out from specific devices or all other devices

## Security Benefits

- Users can see if their account is being used from unknown locations
- Ability to revoke access from suspicious sessions
- Clear visibility of all active sessions
- IP address tracking for security monitoring

## Frontend Integration

The `isCurrentSession` flag helps the frontend:
- Highlight the current session differently
- Prevent users from logging out their current session
- Show appropriate UI for session management 