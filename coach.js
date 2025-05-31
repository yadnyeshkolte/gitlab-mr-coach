const axios = require('axios');
const { MongoClient } = require('mongodb');

class MRCoach {
    constructor() {
        this.gitlabToken = process.env.GITLAB_TOKEN;
        this.googleAIKey = process.env.GOOGLE_AI_API_KEY;
        this.mongoUri = process.env.MONGODB_URI;
        this.projectId = process.env.CI_PROJECT_ID;
        this.mrIid = process.env.CI_MERGE_REQUEST_IID;
        this.gitlabUrl = process.env.CI_SERVER_URL || 'https://gitlab.com';

        this.gitlabApi = axios.create({
            baseURL: `${this.gitlabUrl}/api/v4`,
            headers: { 'Authorization': `Bearer ${this.gitlabToken}` }
        });
    }

    async fetchMRChanges() {
        console.log('📥 Fetching MR changes...');

        try {
            const response = await this.gitlabApi.get(
                `/projects/${this.projectId}/merge_requests/${this.mrIid}/changes`
            );

            const changes = response.data.changes.filter(change =>
                change.diff && !change.new_file && !change.deleted_file
            );

            console.log(`Found ${changes.length} modified files`);
            return changes;
        } catch (error) {
            console.error('❌ Failed to fetch MR changes:', error.message);
            throw error;
        }
    }

    async analyzeWithAI(filePath, diff) {
        console.log(`🔍 Analyzing ${filePath}...`);

        const prompt = `
You are a code review expert. Analyze this code diff and provide concise, actionable feedback.
Focus on:
- Security vulnerabilities
- Performance issues
- Code style and best practices
- Potential bugs

File: ${filePath}
Diff:
${diff}

Provide feedback in this JSON format:
{
  "suggestions": [
    {
      "line": 10,
      "type": "security|performance|style|bug",
      "message": "Brief description of the issue",
      "suggestion": "How to fix it"
    }
  ]
}

Only include serious issues. If the code looks good, return {"suggestions": []}.`;

        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${this.googleAIKey}`,
                {
                    contents: [{
                        parts: [{ text: prompt }]
                    }]
                },
                {
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            const aiResponse = response.data.candidates[0].content.parts[0].text;

            // Try to extract JSON from the response
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            return { suggestions: [] };
        } catch (error) {
            console.error(`❌ AI analysis failed for ${filePath}:`, error.message);
            return { suggestions: [] };
        }
    }

    async postComment(message, filePath = null, lineNumber = null) {
        try {
            const commentData = {
                body: message
            };

            if (filePath && lineNumber) {
                // Post as a line comment
                commentData.position = {
                    base_sha: process.env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA,
                    start_sha: process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA,
                    head_sha: process.env.CI_COMMIT_SHA,
                    position_type: 'text',
                    new_path: filePath,
                    new_line: lineNumber
                };
            }

            await this.gitlabApi.post(
                `/projects/${this.projectId}/merge_requests/${this.mrIid}/discussions`,
                commentData
            );

            console.log(`💬 Posted comment${filePath ? ` on ${filePath}:${lineNumber}` : ''}`);
        } catch (error) {
            console.error('❌ Failed to post comment:', error.message);
            // Fallback to general MR comment
            if (filePath) {
                await this.postComment(`**${filePath}:${lineNumber}**\n\n${message}`);
            }
        }
    }

    async saveMetrics(suggestions, filePath) {
        if (!this.mongoUri) {
            console.log('⚠️  No MongoDB URI provided, skipping metrics');
            return;
        }

        try {
            const client = new MongoClient(this.mongoUri);
            await client.connect();

            const db = client.db('mr_coach');
            const collection = db.collection('feedback');

            for (const suggestion of suggestions) {
                await collection.insertOne({
                    projectId: this.projectId,
                    mrIid: this.mrIid,
                    filePath,
                    line: suggestion.line,
                    type: suggestion.type,
                    message: suggestion.message,
                    timestamp: new Date()
                });
            }

            await client.close();
            console.log(`📊 Saved ${suggestions.length} metrics to database`);
        } catch (error) {
            console.error('❌ Failed to save metrics:', error.message);
        }
    }

    async run() {
        try {
            const changes = await this.fetchMRChanges();
            let totalSuggestions = 0;

            if (changes.length === 0) {
                await this.postComment('🤖 **MR Coach**: No code changes detected to review.');
                return;
            }

            await this.postComment('🤖 **MR Coach** is analyzing your changes... Please wait for feedback!');

            for (const change of changes.slice(0, 5)) { // Limit to 5 files to stay within API limits
                const analysis = await this.analyzeWithAI(change.new_path, change.diff);

                if (analysis.suggestions.length > 0) {
                    totalSuggestions += analysis.suggestions.length;

                    for (const suggestion of analysis.suggestions) {
                        const message = `🔍 **${suggestion.type.toUpperCase()}**: ${suggestion.message}\n\n💡 **Suggestion**: ${suggestion.suggestion}`;
                        await this.postComment(message, change.new_path, suggestion.line);
                    }

                    await this.saveMetrics(analysis.suggestions, change.new_path);
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const summaryMessage = totalSuggestions > 0
                ? `🎉 **MR Coach Summary**: Found ${totalSuggestions} suggestions for improvement!`
                : '✅ **MR Coach Summary**: Your code looks great! No issues found.';

            await this.postComment(summaryMessage);

        } catch (error) {
            console.error('❌ MR Coach failed:', error);
            await this.postComment('🚨 **MR Coach Error**: Failed to analyze changes. Please check the pipeline logs.');
            process.exit(1);
        }
    }
}

// Run the coach
const coach = new MRCoach();
coach.run().catch(console.error);