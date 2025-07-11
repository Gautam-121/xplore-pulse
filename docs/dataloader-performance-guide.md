# DataLoader Performance Optimization Guide

## Overview

This document explains the DataLoader implementation in our GraphQL API and how it significantly improves performance by solving the N+1 query problem.

## What is DataLoader?

DataLoader is a utility that provides batching and caching for GraphQL resolvers. It solves the N+1 query problem by:

1. **Batching**: Collecting multiple individual requests and executing them as a single batch
2. **Caching**: Storing results in memory to avoid duplicate database queries
3. **Deduplication**: Ensuring identical requests are only executed once

## Performance Benefits

### Before DataLoader (N+1 Problem)
```javascript
// Without DataLoader - Each user triggers a separate query
const users = await User.findAll();
// For each user, a separate query is executed
users.forEach(user => {
  const interests = await user.getInterests(); // N+1 queries!
});
```

### After DataLoader (Optimized)
```javascript
// With DataLoader - Single batch query
const users = await User.findAll();
// All interests loaded in one batch query
const userInterests = await Promise.all(
  users.map(user => context.loaders.userInterestsLoader.load(user.id))
);
```

## Our DataLoader Implementation

### Available Loaders

#### 1. User Loaders
- **`userLoader`**: Loads users with their interests
- **`userInterestsLoader`**: Loads interests for multiple users
- **`userMembershipLoader`**: Loads community memberships for users

#### 2. Community Loaders
- **`communityLoader`**: Loads communities with owners and interests
- **`communityMemberCountLoader`**: Loads member counts for communities
- **`userCommunityPermissionLoader`**: Loads user permissions for communities

#### 3. Post Loaders
- **`postLikeLoader`**: Loads post like status for users
- **`postBookmarkLoader`**: Loads post bookmark status for users
- **`eventRegistrationLoader`**: Loads event registration status for users

### Configuration Options

Each loader is configured with:
```javascript
{
  cacheKeyFn: (key) => key,           // Custom cache key function
  maxBatchSize: 100,                  // Maximum items per batch
  cache: true                         // Enable caching
}
```

## Usage in Resolvers

### Field Resolvers
```javascript
Community: {
  memberCount: async (parent, args, context) => {
    try {
      return await context.loaders.communityMemberCountLoader.load(parent.id);
    } catch (error) {
      logger.error('Error loading member count', { error, communityId: parent.id });
      return 0;
    }
  },

  owner: async (parent, args, context) => {
    if (parent.owner) return parent.owner;
    
    try {
      const user = await context.loaders.userLoader.load(parent.ownerId);
      return user;
    } catch (error) {
      logger.error('Error loading community owner', { error, communityId: parent.id });
      return null;
    }
  }
}
```

### Complex Permission Checks
```javascript
isAdmin: async (parent, args, context) => {
  const { user } = context;
  if (!user) return false;
  
  try {
    const permission = await context.loaders.userCommunityPermissionLoader.load({
      userId: user.id,
      communityId: parent.id
    });
    return permission.isAdmin;
  } catch (error) {
    logger.error('Error loading admin status', { error, userId: user.id, communityId: parent.id });
    return false;
  }
}
```

## Performance Monitoring

### Built-in Monitoring
Our implementation includes performance monitoring that tracks:

- **Loader call frequency**: How often each loader is called
- **Batch sizes**: Average number of items per batch
- **Response times**: Average duration of loader calls
- **Cache hit rates**: Percentage of cache hits vs misses

### Performance Thresholds
- **Slow loader calls**: > 100ms (logged as warnings)
- **Slow resolver calls**: > 200ms (logged as warnings)

### Monitoring Usage
```javascript
const { performanceMonitor } = require('../utils/performance');

// Get performance summary
const summary = performanceMonitor.getPerformanceSummary();
console.log('Loader Performance:', summary.loaders);

// Log performance summary
performanceMonitor.logPerformanceSummary();
```

## Best Practices

### 1. Error Handling
Always wrap DataLoader calls in try-catch blocks:
```javascript
try {
  const user = await context.loaders.userLoader.load(userId);
  return user;
} catch (error) {
  logger.error('Error loading user', { error, userId });
  return null; // or throw appropriate GraphQL error
}
```

### 2. Cache Management
- DataLoaders are per-request, so cache is cleared between requests
- For long-lived caches, consider Redis or similar
- Monitor cache hit rates to optimize cache strategies

### 3. Batch Size Optimization
- Monitor `maxBatchSize` settings
- Too small: More database round trips
- Too large: Memory usage and query complexity
- Recommended: 50-100 for most use cases

### 4. Database Query Optimization
- Ensure database indexes on frequently queried fields
- Use `include` sparingly in DataLoader queries
- Consider separate loaders for different data shapes

### 5. Memory Management
- DataLoaders cache results in memory
- Monitor memory usage in production
- Consider cache TTL for long-running processes

## Performance Metrics

### Expected Improvements
- **Query reduction**: 70-90% fewer database queries
- **Response time**: 50-80% faster response times
- **Memory usage**: Efficient caching reduces repeated queries

### Monitoring Metrics
```javascript
{
  "userLoader": {
    "totalCalls": 150,
    "avgBatchSize": 8.5,
    "avgDuration": 45.2,
    "cacheHitRate": 85.3
  },
  "communityMemberCountLoader": {
    "totalCalls": 75,
    "avgBatchSize": 12.3,
    "avgDuration": 23.1,
    "cacheHitRate": 92.1
  }
}
```

## Troubleshooting

### Common Issues

#### 1. High Memory Usage
**Problem**: DataLoader cache consuming too much memory
**Solution**: 
- Reduce `maxBatchSize`
- Implement cache TTL
- Monitor cache hit rates

#### 2. Slow Loader Calls
**Problem**: Individual loader calls taking > 100ms
**Solution**:
- Check database indexes
- Optimize SQL queries
- Consider query complexity

#### 3. Low Cache Hit Rate
**Problem**: Cache hit rate < 50%
**Solution**:
- Review cache key strategy
- Check for unnecessary cache invalidation
- Monitor request patterns

#### 4. N+1 Queries Still Occurring
**Problem**: Some resolvers still causing N+1 queries
**Solution**:
- Ensure all related data uses DataLoaders
- Check for direct database calls in resolvers
- Review field resolver patterns

### Debug Mode
Enable debug logging to track DataLoader performance:
```javascript
// In your logger configuration
logger.debug('DataLoader call', {
  loaderName: 'userLoader',
  batchSize: keys.length,
  duration: Date.now() - startTime
});
```

## Migration Guide

### Adding New DataLoaders

1. **Define the loader function**:
```javascript
const newLoader = new DataLoader(async (keys) => {
  // Batch query logic
  const results = await Model.findAll({
    where: { id: keys },
    include: [/* associations */]
  });
  
  // Map results to match input order
  return keys.map(key => results.find(r => r.id === key));
});
```

2. **Add to context**:
```javascript
// In createUserLoaders()
return {
  // ... existing loaders
  newLoader
};
```

3. **Use in resolvers**:
```javascript
const result = await context.loaders.newLoader.load(id);
```

### Testing DataLoaders

```javascript
// Unit test example
describe('userLoader', () => {
  it('should batch multiple user requests', async () => {
    const loaders = createUserLoaders();
    const userIds = ['user1', 'user2', 'user3'];
    
    const results = await Promise.all(
      userIds.map(id => loaders.userLoader.load(id))
    );
    
    expect(results).toHaveLength(3);
    // Verify only one database query was made
  });
});
```

## Conclusion

DataLoaders are essential for GraphQL performance optimization. Our implementation provides:

- **Efficient batching** of database queries
- **Smart caching** to avoid duplicate requests
- **Comprehensive monitoring** for performance insights
- **Robust error handling** for production reliability

By following these patterns and best practices, you can achieve significant performance improvements in your GraphQL API while maintaining code clarity and maintainability. 