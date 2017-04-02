import { IUrlRewriter, WDRRewriter } from './url-rewriter';
import * as Model from './model';
import * as Stream from 'stream';
import * as Crypto from 'crypto';


export class FilmlisteTransformer extends Stream.Transform {
    urlRewriters: IUrlRewriter[];

    private currentLine: number = 0;
    private currentChannel: string = '';
    private currentTopic: string = '';
    private headerRegex = /".*?",\s"(\d+)\.(\d+)\.(\d+),\s?(\d+):(\d+)"/;

    constructor(...urlRewriters: IUrlRewriter[]) {
        super({ objectMode: true, readableObjectMode: true, writableObjectMode: true, highWaterMark: 100 });
        this.urlRewriters = urlRewriters;
    }

    _transform(rawEntry: string, encoding, callback) {
        this.currentLine++;

        if (this.currentLine > 4) {
            super.push(this.parseLine(rawEntry));
        } else if (this.currentLine == 2) {
            let match = this.headerRegex.exec(rawEntry);
            let timestamp = Math.floor(Date.UTC(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]), parseInt(match[4]), parseInt(match[5])) / 1000);
            this.emit('filmlisteTimestamp', timestamp);
        }

        callback();
    }

    parseLine(rawEntry: string): Model.Entry {
        let parsed = JSON.parse(rawEntry);

        if (parsed[0].length == 0) {
            parsed[0] = this.currentChannel;
        } else {
            this.currentChannel = parsed[0];
        }
        if (parsed[1].length == 0) {
            parsed[1] = this.currentTopic;
        } else {
            this.currentTopic = parsed[1];
        }

        let durationSplit: string = parsed[5].split(':');
        let duration: number = (parseInt(durationSplit[0]) * 60 * 60) + (parseInt(durationSplit[1]) * 60) + parseInt(durationSplit[2]);
        let url_video = parsed[8];
        let url_video_low = this.createUrlFromBase(url_video, parsed[12]);
        let url_video_hd = this.createUrlFromBase(url_video, parsed[14]);
        let url_video_size = parseInt(parsed[6]) * 1000000;

        let videos: Model.Video[] = [];

        for (let i = 0; i < this.urlRewriters.length; i++) {
            let rewriter = this.urlRewriters[i];

            if (rewriter.canHandle(url_video)) {
                videos = rewriter.rewrite(url_video);
                break;
            }
        }

        if (videos.length == 0) {
            videos.push({ url: url_video, size: url_video_size, quality: Model.Quality.Medium });

            if (url_video_low != null) {
                videos.push({ url: url_video_low, size: -1, quality: Model.Quality.Low });
            }
            if (url_video_hd != null) {
                videos.push({ url: url_video_hd, size: -1, quality: Model.Quality.High });
            }
        }

        let entry: Model.Entry = {
            channel: parsed[0],
            topic: parsed[1],
            title: parsed[2],
            description: parsed[7],
            timestamp: parseInt(parsed[16]) | -1,
            duration: duration,
            videos: videos,
            website: parsed[9]
        };

        entry.id = this.md5(JSON.stringify(entry));

        return entry;
    }

    md5(stringOrBuffer: string | Buffer) {
        return Crypto.createHash('md5').update(stringOrBuffer).digest('base64').slice(0, -2);
    }

    createUrlFromBase(base: string, appendix: string) {
        let appendixSplit = appendix.split('|');
        if (appendix.length == 2) {
            return base.substr(0, parseInt(appendixSplit[0])) + appendixSplit[1];
        } else {
            return null;
        }
    }

}
