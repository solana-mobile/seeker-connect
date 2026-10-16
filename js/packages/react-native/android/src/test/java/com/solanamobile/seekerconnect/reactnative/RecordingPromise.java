package com.solanamobile.seekerconnect.reactnative;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableMap;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * A {@link Promise} that records how it settled; {@link #await()} blocks until it does.
 * Java because React Native 0.81 declares {@code reject}'s code non-null and later versions
 * nullable: one Kotlin override can match only one of them, a Java one matches both.
 */
public class RecordingPromise implements Promise {
    private final CountDownLatch settled = new CountDownLatch(1);

    public volatile Object value;
    public volatile String code;
    public volatile boolean rejected;

    public RecordingPromise await() throws InterruptedException {
        if (!settled.await(5, TimeUnit.SECONDS)) {
            throw new IllegalStateException("The promise never settled");
        }
        return this;
    }

    @Override
    public void resolve(Object value) {
        this.value = value;
        settled.countDown();
    }

    private void fail(String code) {
        this.code = code;
        rejected = true;
        settled.countDown();
    }

    @Override
    public void reject(String code, String message) {
        fail(code);
    }

    @Override
    public void reject(String code, Throwable throwable) {
        fail(code);
    }

    @Override
    public void reject(String code, String message, Throwable throwable) {
        fail(code);
    }

    @Override
    public void reject(Throwable throwable) {
        fail(null);
    }

    @Override
    public void reject(Throwable throwable, WritableMap userInfo) {
        fail(null);
    }

    @Override
    public void reject(String code, WritableMap userInfo) {
        fail(code);
    }

    @Override
    public void reject(String code, Throwable throwable, WritableMap userInfo) {
        fail(code);
    }

    @Override
    public void reject(String code, String message, WritableMap userInfo) {
        fail(code);
    }

    @Override
    public void reject(String code, String message, Throwable throwable, WritableMap userInfo) {
        fail(code);
    }

    @Override
    @Deprecated
    public void reject(String message) {
        fail(null);
    }
}
