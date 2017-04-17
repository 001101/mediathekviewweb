#include "filmlisteparser.h"
#include "concurrentqueue.h"
#include "model.h"
#include "sleeper.h"

#include <QCoreApplication>
#include <nan.h>
#include <QString>
#include <QEventLoop>
#include <QObject>
#include <QList>
#include <QDebug>
#include <QTimer>
#include <uv.h>

using namespace v8;
using namespace Nan;

typedef QList<Entry>* EntryBatch;

class NativeFilmlisteParserOLD : public AsyncProgressWorkerBase<EntryBatch> {
    Callback *progressCallback;
    Callback *endCallback;
    QString file;
    QString splitPattern;
    int batchSize;

public:
    NativeFilmlisteParserOLD(Callback *progressCallback, Callback *endCallback, QString file, QString splitPattern, int batchSize) : AsyncProgressWorkerBase<EntryBatch>(endCallback) {
        this->progressCallback = progressCallback;
        this->endCallback = endCallback;
        this->file = file;
        this->splitPattern = splitPattern;
        this->batchSize = batchSize;
    }

    ~NativeFilmlisteParserOLD() {}

    void Execute(const Nan::AsyncProgressWorkerBase<EntryBatch>::ExecutionProgress &progress) {
        int argc;
        char *argv;

        QCoreApplication app(argc, &argv);

        QTimer::singleShot(0,[&](){
            ConcurrentQueue<Entry> entryQueue;
            FilmlisteParser parser;
            parser.parseFile(file, splitPattern, &entryQueue);

            bool isLast = false;
            while(!isLast) {
                EntryBatch entryBatch = new QList<Entry>();
                Q_ASSERT(entryBatch!=nullptr);


                while (!isLast && entryBatch->length() < this->batchSize) {
                    Entry entry;
                    bool success = entryQueue.dequeue(entry, isLast);

                    if (!success) {
                        Sleeper::msleep(1);
                        continue;
                    }

                    entryBatch->append(entry);
                }

                progress.Send(&entryBatch, sizeof(EntryBatch));
            }

            app.quit();
        });

        app.exec();
    }

    void HandleProgressCallback(const EntryBatch* entryBatch, size_t size) {
        Q_ASSERT(entryBatch!=nullptr);
        Nan::HandleScope scope;

        QScopedPointer<QList<Entry>> batch(*entryBatch);

        int count = batch->length();
        v8::Local<v8::Array> results = Nan::New<v8::Array>(count);

        for (int i = 0; i < count; i++) {
            Entry entry = batch->at(i);

            Local<Object> entryObj = Nan::New<Object>();
            Nan::Set(entryObj, Nan::New("id").ToLocalChecked(), New<v8::String>(entry.id.toStdString()).ToLocalChecked());
            Nan::Set(entryObj, Nan::New("channel").ToLocalChecked(), New<v8::String>(entry.channel.toStdString()).ToLocalChecked());
            Nan::Set(entryObj, Nan::New("topic").ToLocalChecked(), New<v8::String>(entry.topic.toStdString()).ToLocalChecked());
            Nan::Set(entryObj, Nan::New("title").ToLocalChecked(), New<v8::String>(entry.title.toStdString()).ToLocalChecked());
            Nan::Set(entryObj, Nan::New("timestamp").ToLocalChecked(), New<v8::Int32>(entry.timestamp));
            Nan::Set(entryObj, Nan::New("duration").ToLocalChecked(), New<v8::Int32>(entry.duration));
            Nan::Set(entryObj, Nan::New("description").ToLocalChecked(), New<v8::String>(entry.description.toStdString()).ToLocalChecked());
            Nan::Set(entryObj, Nan::New("website").ToLocalChecked(), New<v8::String>(entry.website.toStdString()).ToLocalChecked());


            int videoCount = entry.videos.length();
            v8::Local<v8::Array> videoArray = Nan::New<v8::Array>(videoCount);
            for (int j = 0; j < videoCount; j++) {
                Video video = entry.videos.at(j);

                Local<Object> videoObj = Nan::New<Object>();
                Nan::Set(videoObj, Nan::New("url").ToLocalChecked(), New<v8::String>(video.url.toStdString()).ToLocalChecked());
                Nan::Set(videoObj, Nan::New("quality").ToLocalChecked(), New<v8::Int32>(static_cast<int>(video.quality)));
                Nan::Set(videoObj, Nan::New("size").ToLocalChecked(), New<v8::Int32>(video.size));

                Nan::Set(videoArray, j, videoObj);
            }

            Nan::Set(entryObj, Nan::New("videos").ToLocalChecked(), videoArray);

            Nan::Set(results, i, entryObj);
        }

        v8::Local<v8::Value> argv[] = {
            results
            //Nan::New<v8::String>("entryBatch").ToLocalChecked()
        };

        progressCallback->Call(sizeof(argv)/sizeof(v8::Local<v8::Value>), argv);
    }

    void WorkComplete() {
        AsyncProgressWorkerBase<EntryBatch>::WorkComplete();
    }

    void HandleOKCallback() {
        AsyncProgressWorkerBase<EntryBatch>::HandleOKCallback();
    }

    void HandleErrorCallback() {
        AsyncProgressWorkerBase<EntryBatch>::HandleErrorCallback();
        qDebug() << "ERROR";
    }

    void Destroy() {
        delete this->progressCallback;

        AsyncProgressWorkerBase<EntryBatch>::Destroy();
    }

};


class NativeFilmlisteParser {
    Callback *progressCallback;
    Callback *endCallback;
    QString file;
    QString splitPattern;
    int batchSize;
    uv_async_t* async;
    uv_work_t request;

    QMutex batchMutex;
    QList<Entry> entryBatch; //must be guarded by batchmutex
    bool shouldTerminate;  //must be guarded by batchmutex


public:


    //Called in threadpool
    static void AsyncExecute (uv_work_t* req) {
        NativeFilmlisteParser *worker = static_cast<NativeFilmlisteParser*>(req->data);
        worker->Execute();
    }

    //Called when in v8 main thread, after a signal has been reveived
    static NAUV_WORK_CB(AsyncProgress) {
        NativeFilmlisteParser *worker = static_cast<NativeFilmlisteParser*>(async->data);
        worker->WorkProgress();
     }

    //called when Execute() is done (threadpool)
    static void AsyncExecuteComplete (uv_work_t* req) {
      NativeFilmlisteParser* worker = static_cast<NativeFilmlisteParser*>(req->data);

     // worker->WorkComplete();
     // worker->Destroy();

    }

    //Called when async stuff is done (triggerd by uv_close)
    inline static void AsyncClose(uv_handle_t* handle) {
      NativeFilmlisteParser *worker = static_cast<NativeFilmlisteParser*>(handle->data);

      Nan::HandleScope scope;
      worker->endCallback->Call(0, NULL);

      delete reinterpret_cast<uv_async_t*>(handle);
      delete worker;
    }




    NativeFilmlisteParser(Callback *progressCallback, Callback *endCallback, QString file, QString splitPattern, int batchSize) {
        this->progressCallback = progressCallback;
        this->endCallback = endCallback;
        this->file = file;
        this->splitPattern = splitPattern;
        this->batchSize = batchSize;
        this->shouldTerminate = false;


        //Create async => AsyncProgress will be called whenever nodejs has time for it (in the v8 thread)
        async = new uv_async_t;
            uv_async_init(
                uv_default_loop()
              , async
              , NativeFilmlisteParser::AsyncProgress
            );
        async->data = this;


        //Create a Thread with v8 => AsyncExecute will be called once, and AsyncExecuteComplete afterwards
        request.data = this;

        uv_queue_work(
              uv_default_loop()
            , &request
            , NativeFilmlisteParser::AsyncExecute
            , reinterpret_cast<uv_after_work_cb>(NativeFilmlisteParser::AsyncExecuteComplete)
          );



    }

    void Destroy() {
         uv_close(reinterpret_cast<uv_handle_t*>(async), NativeFilmlisteParser::AsyncClose);
    }

    ~NativeFilmlisteParser() {

    }

    void WorkProgress() {
        //in v8 thread

         QList<Entry> localBatch;
         batchMutex.lock();
         entryBatch.swap(localBatch);
         bool localShouldTerminate = shouldTerminate;
         batchMutex.unlock();

         qDebug() << localBatch.length();


         Nan::HandleScope scope;


         int count = localBatch.length();


         v8::Local<v8::Array> results = Nan::New<v8::Array>(count);

         for (int i = 0; i < count; i++) {
             Entry entry = localBatch[i];

             Local<Object> entryObj = Nan::New<Object>();
             Nan::Set(entryObj, Nan::New("id").ToLocalChecked(), New<v8::String>(entry.id.toStdString()).ToLocalChecked());
             Nan::Set(entryObj, Nan::New("channel").ToLocalChecked(), New<v8::String>(entry.channel.toStdString()).ToLocalChecked());
             Nan::Set(entryObj, Nan::New("topic").ToLocalChecked(), New<v8::String>(entry.topic.toStdString()).ToLocalChecked());
             Nan::Set(entryObj, Nan::New("title").ToLocalChecked(), New<v8::String>(entry.title.toStdString()).ToLocalChecked());
             Nan::Set(entryObj, Nan::New("timestamp").ToLocalChecked(), New<v8::Int32>(entry.timestamp));
             Nan::Set(entryObj, Nan::New("duration").ToLocalChecked(), New<v8::Int32>(entry.duration));
             Nan::Set(entryObj, Nan::New("description").ToLocalChecked(), New<v8::String>(entry.description.toStdString()).ToLocalChecked());
             Nan::Set(entryObj, Nan::New("website").ToLocalChecked(), New<v8::String>(entry.website.toStdString()).ToLocalChecked());


             int videoCount = entry.videos.length();
             v8::Local<v8::Array> videoArray = Nan::New<v8::Array>(videoCount);
             for (int j = 0; j < videoCount; j++) {
                 Video video = entry.videos.at(j);

                 Local<Object> videoObj = Nan::New<Object>();
                 Nan::Set(videoObj, Nan::New("url").ToLocalChecked(), New<v8::String>(video.url.toStdString()).ToLocalChecked());
                 Nan::Set(videoObj, Nan::New("quality").ToLocalChecked(), New<v8::Int32>(static_cast<int>(video.quality)));
                 Nan::Set(videoObj, Nan::New("size").ToLocalChecked(), New<v8::Int32>(video.size));

                 Nan::Set(videoArray, j, videoObj);
             }

             Nan::Set(entryObj, Nan::New("videos").ToLocalChecked(), videoArray);

             Nan::Set(results, i, entryObj);
         }

         v8::Local<v8::Value> argv[] = {
             results
             //Nan::New<v8::String>("entryBatch").ToLocalChecked()
         };

         progressCallback->Call(sizeof(argv)/sizeof(v8::Local<v8::Value>), argv);

         if(localShouldTerminate) {
             Destroy();
            return;
         }





    }


    void Execute() {
        int argc;
        char *argv;

        QCoreApplication app(argc, &argv);

        QTimer::singleShot(0,[&](){
            ConcurrentQueue<Entry> entryQueue;
            FilmlisteParser parser;
            parser.parseFile(file, splitPattern, &entryQueue);//async? ja geht dann direkt zum näcghsten

            bool isLast = false;
            while(!isLast) {
                QList<Entry> localBatch;

                while (!isLast && localBatch.length() < this->batchSize) {
                    Entry entry;
                    bool success = entryQueue.dequeue(entry, isLast);

                    if (!success) {
                        Sleeper::msleep(1);
                        continue;
                    }

                    localBatch.append(entry);
                }

                //Todo: fix with queue
                batchMutex.lock();
                if(entryBatch.isEmpty()) {
                    entryBatch.swap(localBatch);
                } else {
                    entryBatch.append(localBatch);
                }
                batchMutex.unlock();

                uv_async_send(async); //Queue async callback to be called

            }


            batchMutex.lock();
            shouldTerminate = true;
            batchMutex.unlock();



            app.quit();

        });

        app.exec();
    }
};



NAN_METHOD(DoProgress) {
    Callback *progressCallback = new Callback(info[2].As<v8::Function>());
    Callback *endCallback = new Callback(info[3].As<v8::Function>());

    Utf8String arg0(info[0]);
    Utf8String arg1(info[1]);

    QString file = QString::fromUtf8(*arg0, arg0.length());
    QString splitPattern = QString::fromUtf8(*arg1, arg1.length());

   new NativeFilmlisteParser(progressCallback, endCallback, file, splitPattern, 100);
}

NAN_MODULE_INIT(Init) {
    Nan::Set(target
             , New<v8::String>("a").ToLocalChecked()
             , New<v8::FunctionTemplate>(DoProgress)->GetFunction());
}

NODE_MODULE(asyncprogressworker, Init)


/*
    void parseFilmliste(const v8::FunctionCallbackInfo<Value>& info) {
    Utf8String arg0(info[0]);
    Utf8String arg1(info[1]);
    Callback *callback = new Callback(info[2].As<Function>());

    QString filename = QString::fromUtf8(*arg0, arg0.length());
    QString splitPattern = QString::fromUtf8(*arg1, arg1.length());
}

void Init(Local<Object> exports, Local<Object> module) {
    NODE_SET_METHOD(module, "exports", parseFilmliste);
}

NODE_MODULE(addon, Init)
*/
