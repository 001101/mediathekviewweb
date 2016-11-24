const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const SearchEngine = require('./SearchEngine.js');
const MediathekIndexer = require('./MediathekIndexer.js');
const Hjson = require('hjson');
const exec = require('child_process').exec;

const config = Hjson.parse(fs.readFileSync('config.hjson', 'utf8'));
config.mediathekUpdateInterval = parseInt(config.mediathekUpdateInterval) * 60 * 1000;
console.log(config);

var app = express();
var httpServer = http.Server(app);
var io = require('socket.io')(httpServer);
var searchEngine = new SearchEngine(config.redis.host, config.redis.port, config.redis.password, config.redis.db1, config.redis.db2);
var mediathekIndexer = new MediathekIndexer(config.workerCount, config.redis.host, config.redis.port, config.redis.password, config.redis.db1, config.redis.db2);
var websiteNames = [];

var indexing = false;
var lastIndexingState;
var updateLoopTimeout;

app.use('/static', express.static('static'));

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
});

io.on('connection', (socket) => {
    if (indexing && lastIndexingState != null) {
        socket.emit('indexState', lastIndexingState);
    }
    socket.on('queryEntry', (query) => {
        if (indexing) {
            return;
        }

        queryEntries(query.queryString, query.mode, query.filters, (result) => {
            socket.emit('queryResult', result);
        });
    });
    socket.on('getWebsiteNames', () => {
        searchEngine.getWebsiteNames((result) => {
            socket.emit('websiteNames', result);
            websiteNames = result;
        });
    });
});

httpServer.listen(config.webserverPort, () => {
    console.log('server listening on *:' + config.webserverPort);
});

function queryEntries(query, mode, filters, callback) {
    console.log('querying ' + query);
    let begin = Date.now();

    searchEngine.search(query, config.min_word_size, mode, (results, err) => {
        if (err) {
            console.log(err);
            callback([]);
            return;
        }

        let searchEngineTime = Date.now() - begin;
        begin = Date.now();
        let resultCount = results.length;

        if (filters.websiteNames.length != websiteNames.length) {
            results = results.filter((entry) => {
                return filters.websiteNames.includes(entry.data.websiteName);
            });
        }

        results = results.sort((a, b) => {
            let relevanceDiff = b.relevance - a.relevance;
            if (relevanceDiff == 0) {
                return b.data.timestamp - a.data.timestamp;
            } else {
                return relevanceDiff;
            }
        }).slice(0, 50);

        let filterTime = Date.now() - begin;
        let queryInfo = {
            searchEngineTime: searchEngineTime,
            filterTime: filterTime,
            resultCount: resultCount
        };

        callback({
            results: results,
            queryInfo: queryInfo
        });

        console.log('query took ' + (Date.now() - begin) / 1000 + ' seconds');

    });
}

mediathekIndexer.on('state', (state) => {
    lastIndexingState = state;
    io.sockets.emit('indexState', state);

    console.log();
    console.log('\tprogress: ' + (state.progress * 100).toFixed(2) + '%');
    console.log('\tentries: ' + state.entries);
    console.log('\tindices: ' + state.indices);
    console.log('\ttime: ' + (state.time / 1000) + ' seconds');

    if (state.done) {
        indexing = false;
        console.log();
    }
});


function updateMediathek(callback) {
    let content = "";
    let req = http.get('http://zdfmediathk.sourceforge.net/akt.xml', function(res) {
        res.setEncoding("utf8");
        res.on("data", function(chunk) {
            content += chunk;
        });

        res.on("end", function() {
            let filmlisteUrlRegex = /<URL>\s*(.*?)\s*<\/URL>/g;
            let urlMatches = [];

            let match;
            while ((match = filmlisteUrlRegex.exec(content)) !== null) {
                urlMatches.push(match);
            }

            let url = urlMatches[Math.floor(Math.random() * urlMatches.length)][1];

            let request = http.get(url, function(response) {
                let filename = config.filmliste + '.xz';
                fs.stat(filename, (err, stats) => {
                    if (!err) {
                        fs.unlinkSync(filename);
                    }
                    let fileStream = fs.createWriteStream(config.filmliste + '.xz');
                    response.pipe(fileStream);
                    response.on('end', () => {
                        fs.stat(config.filmliste, (err, stats) => {
                            if (!err) {
                                fs.unlinkSync(config.filmliste);
                            }

                            exec('unxz ' + config.filmliste + '.xz').on('exit', () => {
                                callback();
                            });
                        });
                    });
                });
            });

            request.on('error', (e) => {
                console.log('Error downloading filmliste: ' + e.message);
                console.log('Trying again in 1 minute');

                clearTimeout(updateLoopTimeout);
                updateLoopTimeout = setTimeout(updateLoop, 1 * 60 * 1000);
            });
        });
    });
    req.end();
}

function indexMediathek() {
    indexing = true;
    mediathekIndexer.indexFile(config.filmliste, config.min_word_size);
}


function updateLoop() {
    if (config.index) {
        updateMediathek(() => {
            indexMediathek(() => {
                updateLoopTimeout = setTimeout(updateLoop, config.mediathekUpdateInterval);
            });
        });
    }
}

mediathekIndexer.getLastIndexCompleted((completed) => {
    if (completed) {
        mediathekIndexer.getLastIndexTimestamp((result) => {
            let timeToNextUpdate = Math.min((parseInt(result) + config.mediathekUpdateInterval) - Date.now(), config.mediathekUpdateInterval);
            console.log('scheduling next filmliste update in about ' + moment.duration(timeToNextUpdate).humanize());
            setTimeout(updateLoop, timeToNextUpdate);
        });
    } else {
        console.log('updating filmliste now');
        setTimeout(updateLoop, 0);
    }
});
