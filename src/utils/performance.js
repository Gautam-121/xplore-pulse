const logger = require('./logger');

class PerformanceMonitor {
    constructor() {
        this.timers = new Map();
        this.metrics = {
            dataloader: {
                totalCalls: 0,
                totalDuration: 0,
                averageDuration: 0,
                cacheHits: 0,
                cacheMisses: 0,
                batchSizes: [],
                slowCalls: []
            },
            resolvers: {
                totalCalls: 0,
                totalDuration: 0,
                averageDuration: 0,
                slowCalls: []
            }
        };
    }

    /**
     * Start a timer for performance monitoring
     * @param {string} name - Timer name
     * @param {Object} metadata - Additional metadata
     */
    startTimer(name, metadata = {}) {
        const timerId = `${name}_${Date.now()}_${Math.random()}`;
        this.timers.set(timerId, {
            name,
            startTime: process.hrtime.bigint(),
            metadata
        });
        return timerId;
    }

    /**
     * End a timer and record metrics
     * @param {string} timerId - Timer ID returned from startTimer
     * @param {Object} additionalData - Additional data to record
     */
    endTimer(timerId, additionalData = {}) {
        const timer = this.timers.get(timerId);
        if (!timer) {
            logger.warn('Timer not found', { timerId });
            return;
        }

        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - timer.startTime) / 1000000; // Convert to milliseconds

        // Record metrics based on timer name
        if (timer.name.includes('Loader')) {
            this.recordDataLoaderMetrics(timer.name, duration, { ...timer.metadata, ...additionalData });
        } else {
            this.recordResolverMetrics(timer.name, duration, { ...timer.metadata, ...additionalData });
        }

        // Log slow calls
        if (duration > 100) { // Log calls taking more than 100ms
            logger.warn('Slow operation detected', {
                operation: timer.name,
                duration: `${duration.toFixed(2)}ms`,
                metadata: { ...timer.metadata, ...additionalData }
            });
        }

        this.timers.delete(timerId);
    }

    /**
     * Record DataLoader metrics
     * @param {string} name - Loader name
     * @param {number} duration - Duration in milliseconds
     * @param {Object} data - Additional data
     */
    recordDataLoaderMetrics(name, duration, data) {
        const metrics = this.metrics.dataloader;
        metrics.totalCalls++;
        metrics.totalDuration += duration;
        metrics.averageDuration = metrics.totalDuration / metrics.totalCalls;

        if (data.batchSize) {
            metrics.batchSizes.push(data.batchSize);
            // Keep only last 100 batch sizes
            if (metrics.batchSizes.length > 100) {
                metrics.batchSizes = metrics.batchSizes.slice(-100);
            }
        }

        if (duration > 50) { // Consider calls over 50ms as slow
            metrics.slowCalls.push({
                name,
                duration,
                timestamp: new Date().toISOString(),
                data
            });
            // Keep only last 50 slow calls
            if (metrics.slowCalls.length > 50) {
                metrics.slowCalls = metrics.slowCalls.slice(-50);
            }
        }

        // Log performance data periodically
        if (metrics.totalCalls % 100 === 0) {
            this.logDataLoaderStats();
        }
    }

    /**
     * Record resolver metrics
     * @param {string} name - Resolver name
     * @param {number} duration - Duration in milliseconds
     * @param {Object} data - Additional data
     */
    recordResolverMetrics(name, duration, data) {
        const metrics = this.metrics.resolvers;
        metrics.totalCalls++;
        metrics.totalDuration += duration;
        metrics.averageDuration = metrics.totalDuration / metrics.totalCalls;

        if (duration > 100) { // Consider calls over 100ms as slow
            metrics.slowCalls.push({
                name,
                duration,
                timestamp: new Date().toISOString(),
                data
            });
            // Keep only last 50 slow calls
            if (metrics.slowCalls.length > 50) {
                metrics.slowCalls = metrics.slowCalls.slice(-50);
            }
        }
    }

    /**
     * Log DataLoader statistics
     */
    logDataLoaderStats() {
        const metrics = this.metrics.dataloader;
        const avgBatchSize = metrics.batchSizes.length > 0 
            ? metrics.batchSizes.reduce((a, b) => a + b, 0) / metrics.batchSizes.length 
            : 0;

        logger.info('DataLoader Performance Stats', {
            totalCalls: metrics.totalCalls,
            averageDuration: `${metrics.averageDuration.toFixed(2)}ms`,
            averageBatchSize: Math.round(avgBatchSize),
            slowCallsCount: metrics.slowCalls.length,
            cacheHitRate: metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses) || 0
        });
    }

    /**
     * Get current performance metrics
     * @returns {Object} Performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Reset all metrics
     */
    resetMetrics() {
        this.metrics = {
            dataloader: {
                totalCalls: 0,
                totalDuration: 0,
                averageDuration: 0,
                cacheHits: 0,
                cacheMisses: 0,
                batchSizes: [],
                slowCalls: []
            },
            resolvers: {
                totalCalls: 0,
                totalDuration: 0,
                averageDuration: 0,
                slowCalls: []
            }
        };
        logger.info('Performance metrics reset');
    }

    /**
     * Get performance report
     * @returns {Object} Performance report
     */
    getReport() {
        const metrics = this.metrics;
        const dataloaderMetrics = metrics.dataloader;
        const resolverMetrics = metrics.resolvers;

        return {
            summary: {
                totalDataLoaderCalls: dataloaderMetrics.totalCalls,
                totalResolverCalls: resolverMetrics.totalCalls,
                averageDataLoaderDuration: `${dataloaderMetrics.averageDuration.toFixed(2)}ms`,
                averageResolverDuration: `${resolverMetrics.averageDuration.toFixed(2)}ms`,
                slowDataLoaderCalls: dataloaderMetrics.slowCalls.length,
                slowResolverCalls: resolverMetrics.slowCalls.length
            },
            details: {
                dataloader: dataloaderMetrics,
                resolvers: resolverMetrics
            },
            recommendations: this.generateRecommendations()
        };
    }

    /**
     * Generate performance recommendations
     * @returns {Array} List of recommendations
     */
    generateRecommendations() {
        const recommendations = [];
        const metrics = this.metrics;

        // DataLoader recommendations
        if (metrics.dataloader.averageDuration > 50) {
            recommendations.push({
                type: 'dataloader',
                severity: 'warning',
                message: 'DataLoader average duration is high. Consider optimizing database queries or adding indexes.',
                metric: `${metrics.dataloader.averageDuration.toFixed(2)}ms`
            });
        }

        if (metrics.dataloader.slowCalls.length > 10) {
            recommendations.push({
                type: 'dataloader',
                severity: 'error',
                message: 'Too many slow DataLoader calls detected. Review query performance.',
                metric: `${metrics.dataloader.slowCalls.length} slow calls`
            });
        }

        // Resolver recommendations
        if (metrics.resolvers.averageDuration > 100) {
            recommendations.push({
                type: 'resolver',
                severity: 'warning',
                message: 'Resolver average duration is high. Consider using DataLoaders or optimizing business logic.',
                metric: `${metrics.resolvers.averageDuration.toFixed(2)}ms`
            });
        }

        if (metrics.resolvers.slowCalls.length > 5) {
            recommendations.push({
                type: 'resolver',
                severity: 'error',
                message: 'Too many slow resolver calls detected. Review resolver performance.',
                metric: `${metrics.resolvers.slowCalls.length} slow calls`
            });
        }

        return recommendations;
    }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

module.exports = performanceMonitor; 