var REDIS = require('redis');
const utils = require('./utils.js');

class SearchEngine {
    constructor(host = '127.0.0.1', port = 6379, password = '', db1, db2) {
        this.searchIndex = REDIS.createClient({
            host: host,
            port: port,
            password: password,
            db: db1
        });

        this.searchIndex.on('error', (err) => {
            console.log('SearchEngine error: ' + err);
        });

        this.indexData = REDIS.createClient({
            host: host,
            port: port,
            password: password,
            db: db2
        });

        this.indexData.on('error', (err) => {
            console.log('SearchEngine error: ' + err);
        });

        this.destCounter = 0;
    }

    getUniqueDest() {
        return 'uniques:' + this.destCounter++;
    }

    search(q, searchTopic, callback) {
        let query = this.parseQuery(q);

        let channels = [];
        let topics = [];
        let deletions = [];

        let searchTopicResult = [];

        let totalResults = 0;

        let batch = this.searchIndex.batch();

        this.resolveChannelsTopics(query.channels, 'c:', batch, channels, deletions); //channels will contain something like ['channel:ARD', 'channel:ZDF'] after batch.exec()
        this.resolveChannelsTopics(query.topics, 't:', batch, topics, deletions); //topics will contain something like ['topic:Tagesschau', 'topic:Sturm der Liebe'] after batch.exec()

        if (searchTopic == 'auto') {
            searchTopic = topics.length == 0;
        } else {
            searchTopic = searchTopic == 'true';
        }

        if (searchTopic == true && query.titleParts.length > 0) {
            this.resolveChannelsTopics([query.titleParts], 't:', batch, searchTopicResult, deletions); //searchTopicResult will contain something like ['topic:Sturm der Liebe'] after batch.exec()
        }

        batch.exec((err, reply) => {
            if (err) console.log(err);

            let unionSets = [];
            let titleParts = query.titleParts.map((val) => {
                return 'i:' + val;
            });

            let resultBatch = this.searchIndex.batch();


            if (channels.length > 0 && topics.length > 0) {
                for (let i = 0; i < channels.length; i++) {
                    for (let j = 0; j < topics.length; j++) {
                        let unionSet = this.getUniqueDest();
                        unionSets.push(unionSet);
                        let command = [unionSet, channels[i], topics[j]].concat(titleParts);
                        resultBatch.sinterstore(command);
                    }
                }
            } else if (channels.length > 0) {
                for (let i = 0; i < channels.length; i++) {
                    let unionSet = this.getUniqueDest();
                    unionSets.push(unionSet);
                    let command = [unionSet, channels[i]].concat(titleParts);
                    resultBatch.sinterstore(command);
                }
            } else if (topics.length > 0) {
                for (let i = 0; i < topics.length; i++) {
                    let unionSet = this.getUniqueDest();
                    unionSets.push(unionSet);
                    let command = [unionSet, topics[i]].concat(titleParts);
                    resultBatch.sinterstore(command);
                }
            } else {
                let unionSet = this.getUniqueDest();
                unionSets.push(unionSet);
                let command = [unionSet].concat(titleParts);
                resultBatch.sinterstore(command);
            }

            if (searchTopicResult.length > 0) {
                let topicUnion = this.getUniqueDest();
                deletions.push(topicUnion);
                let command = [topicUnion].concat(searchTopicResult);
                resultBatch.sunionstore(command);

                if (channels.length > 0 && topics.length > 0) {
                    for (let i = 0; i < channels.length; i++) {
                        for (let j = 0; j < topics.length; j++) {
                            let unionSet = this.getUniqueDest();
                            unionSets.push(unionSet);
                            let command = [unionSet, channels[i], topics[j]].concat(topicUnion);
                            resultBatch.sinterstore(command);
                        }
                    }
                } else if (channels.length > 0) {
                    for (let i = 0; i < channels.length; i++) {
                        let unionSet = this.getUniqueDest();
                        unionSets.push(unionSet);
                        let command = [unionSet, channels[i]].concat(topicUnion);
                        resultBatch.sinterstore(command);
                    }
                } else if (topics.length > 0) {
                    for (let i = 0; i < topics.length; i++) {
                        let unionSet = this.getUniqueDest();
                        unionSets.push(unionSet);
                        let command = [unionSet, topics[i]].concat(topicUnion);
                        resultBatch.sinterstore(command);
                    }
                }
            }

            let resultSet = this.getUniqueDest();
            let sortedResultSet = this.getUniqueDest();
            deletions.push(resultSet, sortedResultSet);

            resultBatch.sunionstore(resultSet, unionSets);
            resultBatch.scard(resultSet, (err, reply) => {
                totalResults = reply;
            });
            resultBatch.zinterstore(sortedResultSet, 2, 'times', resultSet);
            resultBatch.zrevrange(sortedResultSet, 0, 49, (err, result) => {
                let commands = [];
                for (let i = 0; i < result.length; i++) {
                    commands.push(['hgetall', result[i]]);
                }


                this.indexData.batch(commands).exec((err, result) => {
                    callback({
                        result: result,
                        totalResults: totalResults
                    });
                });
            });

            deletions = deletions.concat(unionSets);
            resultBatch.del(deletions);
            resultBatch.exec();
        });
    }

    resolveChannelsTopics(inputs, suffix, redisBatch, output, deletions) {
        if (inputs.length > 0) {
            let sets = [];
            for (let i = 0; i < inputs.length; i++) {
                let inputSplits = inputs[i].map((val) => {
                    return suffix + val;
                });

                let intersection = this.getUniqueDest();
                deletions.push(intersection);
                sets.push(intersection);
                redisBatch.sinterstore(intersection, inputSplits);
            }
            redisBatch.sunion(sets, (err, result) => {
                for (let i = 0; i < result.length; i++) {
                    output.push(result[i]);
                }
            });
        }
    }

    parseQuery(query) {
        let channels = [];
        let topics = [];
        let titleParts = [];

        let splits = query.trim().toLowerCase().split(/\s+/).filter((split) => {
            return !!split;
        });

        for (let i = 0; i < splits.length; i++) {
            let split = splits[i];

            if (split[0] == '!') {
                channels.push(utils.replaceBadChars(split.slice(1, split.length), ',').split(',').filter((split) => {
                    return !!split;
                }));
            } else if (split[0] == '#') {
                topics.push(utils.replaceBadChars(split.slice(1, split.length), ',').split(',').filter((split) => {
                    return !!split;
                }));
            } else {
                titleParts = titleParts.concat(utils.createGoodSplits(split));
            }
        }

        return {
            channels: channels,
            topics: topics,
            titleParts: titleParts
        }
    }

    getChannels(callback) {
        this.indexData.smembers('channels', (err, reply) => {
            if (err)
                throw Error(err);

            callback(reply);
        });
    }

    getTopics(callback) {
        this.indexData.smembers('topics', (err, reply) => {
            if (err)
                throw Error(err);

            callback(reply);
        });
    }
}

module.exports = SearchEngine;
