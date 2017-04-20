#include "linereader.h"
#include "linereaderworker.h"

LineReader::LineReader(QObject *parent) : QObject(parent) {
    LineReaderWorker *worker = new LineReaderWorker;

    worker->moveToThread(&workerThread);
    connect(&workerThread, &QThread::finished, worker, &QObject::deleteLater);

    connect(this, &LineReader::readFile, worker, &LineReaderWorker::readFile);

    workerThread.start();
}

LineReader::~LineReader() {
    workerThread.quit();
    workerThread.wait();
}
