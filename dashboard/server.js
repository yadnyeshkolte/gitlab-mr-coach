const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB connection
let db;
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mr_coach';

MongoClient.connect(mongoUri)
    .then(client => {
        console.log('📊 Connected to MongoDB');
        db = client.db('mr_coach');
    })
    .catch(error => {
        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    });

// API Routes

// Get overall statistics
app.get('/api/stats', async (req, res) => {
    try {
        const collection = db.collection('feedback');

        const totalSuggestions = await collection.countDocuments();
        const totalMRs = (await collection.distinct('mrIid')).length;
        const totalProjects = (await collection.distinct('projectId')).length;

        // Get suggestions by type
        const suggestionsByType = await collection.aggregate([
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        // Get activity over time (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const dailyActivity = await collection.aggregate([
            { $match: { timestamp: { $gte: thirtyDaysAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                    suggestions: { $sum: 1 },
                    mrs: { $addToSet: '$mrIid' }
                }
            },
            { $addFields: { mrCount: { $size: '$mrs' } } },
            { $sort: { _id: 1 }  }
        ]).toArray();

        res.json({
            totalSuggestions,
            totalMRs,
            totalProjects,
            suggestionsByType: suggestionsByType.map(item => ({
                type: item._id,
                count: item.count
            })),
            dailyActivity: dailyActivity.map(item => ({
                date: item._id,
                suggestions: item.suggestions,
                mrs: item.mrCount
            }))
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Get recent feedback
app.get('/api/recent', async (req, res) => {
    try {
        const collection = db.collection('feedback');
        const limit = parseInt(req.query.limit) || 10;

        const recentFeedback = await collection
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        res.json(recentFeedback);
    } catch (error) {
        console.error('Error fetching recent feedback:', error);
        res.status(500).json({ error: 'Failed to fetch recent feedback' });
    }
});

// Get feedback for specific MR
app.get('/api/mr/:projectId/:mrIid', async (req, res) => {
    try {
        const { projectId, mrIid } = req.params;
        const collection = db.collection('feedback');

        const feedback = await collection
            .find({ projectId, mrIid: parseInt(mrIid) })
            .sort({ timestamp: -1 })
            .toArray();

        res.json(feedback);
    } catch (error) {
        console.error('Error fetching MR feedback:', error);
        res.status(500).json({ error: 'Failed to fetch MR feedback' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve dashboard HTML for any non-API route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`🚀 Dashboard server running on port ${port}`);
    console.log(`📊 Access dashboard at http://localhost:${port}`);
});