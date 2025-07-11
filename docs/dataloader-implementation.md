# DataLoader Implementation Guide

## Overview

DataLoaders are used in our GraphQL backend to solve the N+1 query problem and improve performance through batching and caching. This document explains the implementation, usage, and best practices.

## Architecture

### DataLoader Pattern
```
GraphQL Query → Resolvers → DataLoaders → Database
```

### Key Benefits
1. **Batching**: Multiple requests for the same data type are batched into a single database query
2. **Caching**: Results are cached per request to avoid duplicate queries
3. **Performance**: Reduces database round trips and improves response times
4. **Consistency**: Ensures data consistency across a single request

## Implementation

### 1. DataLoader Setup (`src/loaders/userLoaders.js`)

```javascript
const createUserLoaders = () => {
  // User DataLoader
  const userLoader = new DataLoader(async (userIds) => {
    // Batch load users
    const users = await User.findAll({
      where: { id: { [Op.in]: userIds } }
    });
    
    // Map results in same order as input
    const userMap = new Map();
    users.forEach(user => userMap.set(user.id, user));
    
    return userIds.map(id => userMap.get(id) || null);
  });

  return { userLoader, /* other loaders */ };
};
```

### 2. Context Integration (`src/middleware/context.js`)

```javascript
const createUserLoaders = require('../loaders/userLoaders');

const context = async ({ req }) => {
  const loaders = createUserLoaders();
  
  return {
    user: req.user,
    loaders
  };
};
```

### 3. Resolver Usage

```javascript
// In community resolvers
Community: {
  owner: async (parent, _, { loaders }) => {
    if (!parent.ownerId) return null;
    return await loaders.userLoader.load(parent.ownerId);
  }
}
```

## Available DataLoaders

### User-Related Loaders
- `userLoader`: Load users by ID
- `userByEmailLoader`: Load users by email
- `userInterestsLoader`: Load user interests
- `userCommunitiesLoader`: Load user's joined communities
- `userOwnedCommunitiesLoader`: Load user's owned communities

### Community-Related Loaders
- `communityMembersLoader`: Load community members
- `communityMemberCountLoader`: Load member counts
- `communityOwnerLoader`: Load community owners
- `communityInterestsLoader`: Load community interests

### Post-Related Loaders
- `postLikesLoader`: Load post likes
- `postLikeCountLoader`: Load like counts
- `postBookmarksLoader`: Load post bookmarks
- `eventRegistrationsLoader`: Load event registrations

### Permission Loaders
- `userMembershipStatusLoader`: Load user membership status

## Performance Monitoring

### Performance Utility (`src/utils/performance.js`)

The performance monitor tracks:
- DataLoader call counts and durations
- Batch sizes and efficiency
- Slow calls (over 50ms for DataLoaders, 100ms for resolvers)
- Cache hit rates
- Performance recommendations

### Usage in DataLoaders

```javascript
const userLoader = new DataLoader(async (userIds) => {
  try {
    performanceMonitor.startTimer('userLoader');
    
    const users = await User.findAll({
      where: { id: { [Op.in]: userIds } }
    });
    
    performanceMonitor.endTimer('userLoader', { 
      batchSize: userIds.length, 
      foundCount: users.length 
    });
    
    return result;
  } catch (error) {
    logger.error('Error in userLoader', { error, userIds });
    throw error;
  }
});
```

### Performance Metrics

```javascript
// Get performance report
const report = performanceMonitor.getReport();
console.log(report.summary);
// {
//   totalDataLoaderCalls: 150,
//   averageDataLoaderDuration: "12.5ms",
//   slowDataLoaderCalls: 3,
//   ...
// }
```

## Best Practices

### 1. Input Validation
```javascript
const userLoader = new DataLoader(async (userIds) => {
  // Validate input
  if (!userIds || userIds.length === 0) {
    return [];
  }
  
  // Ensure UUIDs are valid
  const validIds = userIds.filter(id => 
    id && typeof id === 'string' && id.length > 0
  );
  
  // ... rest of implementation
});
```

### 2. Error Handling
```javascript
const userLoader = new DataLoader(async (userIds) => {
  try {
    // ... implementation
  } catch (error) {
    logger.error('Error in userLoader', { error, userIds });
    throw error; // Re-throw to maintain error context
  }
});
```

### 3. Result Mapping
```javascript
// Always map results in the same order as input
const userMap = new Map();
users.forEach(user => userMap.set(user.id, user));

return userIds.map(id => userMap.get(id) || null);
```

### 4. Caching Strategy
```javascript
const userLoader = new DataLoader(async (userIds) => {
  // ... implementation
}, {
  cacheKeyFn: (key) => key, // Use userId as cache key
  maxBatchSize: 100, // Limit batch size
  cache: true // Enable caching
});
```

## Usage Examples

### Basic Usage
```javascript
// Load single user
const user = await loaders.userLoader.load(userId);

// Load multiple users (automatically batched)
const users = await Promise.all([
  loaders.userLoader.load(userId1),
  loaders.userLoader.load(userId2),
  loaders.userLoader.load(userId3)
]);
```

### Complex Relationships
```javascript
// Load community with owner and members
const community = await communityService.getCommunityById(id);
const owner = await loaders.userLoader.load(community.ownerId);
const members = await loaders.communityMembersLoader.load(community.id);

// Attach related data
community.owner = owner;
community.members = members;
```

### Permission Checks
```javascript
// Check user membership status
const status = await loaders.userMembershipStatusLoader.load({
  userId: user.id,
  communityId: community.id
});
```

## Migration Guide

### From Direct Service Calls
```javascript
// Before: Direct service call
const owner = await userService.getUserById(community.ownerId);

// After: DataLoader
const owner = await loaders.userLoader.load(community.ownerId);
```

### From Multiple Individual Queries
```javascript
// Before: N+1 problem
const communities = await getCommunities();
for (const community of communities) {
  community.owner = await getUserById(community.ownerId);
}

// After: Batched with DataLoader
const communities = await getCommunities();
const ownerIds = communities.map(c => c.ownerId);
const owners = await Promise.all(
  ownerIds.map(id => loaders.userLoader.load(id))
);
communities.forEach((community, index) => {
  community.owner = owners[index];
});
```

## Troubleshooting

### Common Issues

1. **Missing DataLoader in Context**
   ```javascript
   // Error: loaders is undefined
   const user = await loaders.userLoader.load(userId);
   
   // Solution: Ensure DataLoaders are created in context middleware
   ```

2. **Incorrect Result Order**
   ```javascript
   // Wrong: Results may not match input order
   return users;
   
   // Correct: Map results to match input order
   return userIds.map(id => userMap.get(id) || null);
   ```

3. **Memory Leaks**
   ```javascript
   // Wrong: DataLoaders persist across requests
   const loaders = createUserLoaders(); // Global instance
   
   // Correct: Create per request
   const context = async ({ req }) => {
     const loaders = createUserLoaders(); // Per request
     return { loaders };
   };
   ```

### Performance Issues

1. **Large Batch Sizes**
   ```javascript
   // Limit batch size to prevent memory issues
   const userLoader = new DataLoader(async (userIds) => {
     // ... implementation
   }, {
     maxBatchSize: 100
   });
   ```

2. **Slow Queries**
   ```javascript
   // Add database indexes
   // Optimize query conditions
   // Use select only needed fields
   const users = await User.findAll({
     where: { id: { [Op.in]: userIds } },
     attributes: ['id', 'name', 'email'] // Only needed fields
   });
   ```

## Monitoring and Debugging

### Performance Logs
```javascript
// Automatic logging of slow operations
if (duration > 100) {
  logger.warn('Slow operation detected', {
    operation: timer.name,
    duration: `${duration.toFixed(2)}ms`
  });
}
```

### Cache Statistics
```javascript
// Monitor cache performance
const report = performanceMonitor.getReport();
console.log('Cache hit rate:', report.details.dataloader.cacheHitRate);
```

### Batch Efficiency
```javascript
// Monitor batch sizes
const avgBatchSize = report.details.dataloader.batchSizes.reduce((a, b) => a + b, 0) / report.details.dataloader.batchSizes.length;
console.log('Average batch size:', avgBatchSize);
```

## Future Enhancements

1. **Redis Caching**: Implement Redis for cross-request caching
2. **Query Optimization**: Add query analysis and optimization suggestions
3. **Auto-scaling**: Implement dynamic batch size adjustment
4. **Metrics Dashboard**: Create real-time performance monitoring dashboard

## Conclusion

DataLoaders are essential for GraphQL performance. This implementation provides:
- Efficient batching and caching
- Comprehensive error handling
- Performance monitoring
- Easy migration path
- Best practices enforcement

Follow the patterns and guidelines in this document to ensure optimal performance and maintainability. 