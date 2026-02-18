package com.actemperature.control;

import android.os.Handler;
import android.os.Looper;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

public class ArduinoCommunication {
    private static final String ARDUINO_IP = "192.168.4.1";
    private static final int ARDUINO_PORT = 80;
    private OkHttpClient client;
    private Handler mainHandler;
    private ArduinoResponseListener listener;

    public interface ArduinoResponseListener {
        void onSuccess(String response);
        void onError(String error);
    }

    public ArduinoCommunication() {
        this.client = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build();
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    public void setListener(ArduinoResponseListener listener) {
        this.listener = listener;
    }

    public void sendTemperature(String location, int temperature) {
        new Thread(() -> {
            try {
                String url = String.format("http://%s:%d/temp?location=%s&temp=%d", 
                    ARDUINO_IP, ARDUINO_PORT, location, temperature);
                
                Request request = new Request.Builder()
                    .url(url)
                    .get()
                    .build();

                Response response = client.newCall(request).execute();
                
                if (response.isSuccessful() && listener != null) {
                    String body = response.body().string();
                    mainHandler.post(() -> listener.onSuccess(body));
                } else if (listener != null) {
                    mainHandler.post(() -> listener.onError("Failed to connect to Arduino"));
                }
                response.close();
            } catch (IOException e) {
                if (listener != null) {
                    mainHandler.post(() -> listener.onError(e.getMessage()));
                }
            }
        }).start();
    }

    public void getStatus() {
        new Thread(() -> {
            try {
                String url = String.format("http://%s:%d/status", ARDUINO_IP, ARDUINO_PORT);
                
                Request request = new Request.Builder()
                    .url(url)
                    .get()
                    .build();

                Response response = client.newCall(request).execute();
                
                if (response.isSuccessful() && listener != null) {
                    String body = response.body().string();
                    mainHandler.post(() -> listener.onSuccess(body));
                }
                response.close();
            } catch (IOException e) {
                if (listener != null) {
                    mainHandler.post(() -> listener.onError(e.getMessage()));
                }
            }
        }).start();
    }
}
