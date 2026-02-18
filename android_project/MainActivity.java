package com.actemperature.control;

import androidx.appcompat.app.AppCompatActivity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.LinearLayout;
import android.view.View;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private TemperatureDatabase database;
    private ArduinoCommunication arduino;
    private SeekBar temperatureSeekBar;
    private TextView currentTempText;
    private TextView locationText;
    private Button applyButton;
    private LinearLayout locationsContainer;

    private String selectedLocation = "Shimla";
    private final List<String> LOCATIONS = Arrays.asList("Shimla", "Manali", "Goa", "Delhi", "Mumbai", "Bangalore");
    private final int[] DEFAULT_TEMPS = {16, 18, 28, 32, 30, 28};

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        database = new TemperatureDatabase(this);
        arduino = new ArduinoCommunication();

        initializeViews();
        loadDefaultLocations();
        setupLocationButtons();
        setupSeekBar();
        setupArduinoListener();
        
        selectLocation("Shimla", null);
    }

    private void initializeViews() {
        temperatureSeekBar = findViewById(R.id.temperatureSeekBar);
        currentTempText = findViewById(R.id.currentTempText);
        locationText = findViewById(R.id.locationText);
        applyButton = findViewById(R.id.applyButton);
        locationsContainer = findViewById(R.id.locationsContainer);
    }

    private void loadDefaultLocations() {
        for (int i = 0; i < LOCATIONS.size(); i++) {
            if (database.getLocationTemperature(LOCATIONS.get(i)) == null) {
                database.saveLocationTemperature(
                    new TemperatureDatabase.LocationTemp(LOCATIONS.get(i), DEFAULT_TEMPS[i], false)
                );
            }
        }
    }

    private void setupLocationButtons() {
        locationsContainer.removeAllViews();
        
        for (String location : LOCATIONS) {
            Button btn = new Button(this);
            btn.setText(location);
            btn.setTag(location);
            
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0, 
                LinearLayout.LayoutParams.WRAP_CONTENT, 
                1f
            );
            params.setMargins(5, 5, 5, 5);
            btn.setLayoutParams(params);
            
            btn.setOnClickListener(v -> selectLocation(location, btn));
            locationsContainer.addView(btn);
        }
    }

    private void selectLocation(String location, Button button) {
        selectedLocation = location;
        locationText.setText("Location: " + location);
        
        TemperatureDatabase.LocationTemp temp = database.getLocationTemperature(location);
        if (temp != null) {
            temperatureSeekBar.setProgress(temp.temperature);
            currentTempText.setText("Temperature: " + temp.temperature + "°C");
        }
    }

    private void setupSeekBar() {
        temperatureSeekBar.setMin(10);
        temperatureSeekBar.setMax(40);
        temperatureSeekBar.setProgress(24);
        
        temperatureSeekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                currentTempText.setText("Temperature: " + progress + "°C");
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {}

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {}
        });

        applyButton.setOnClickListener(v -> applyTemperature());
    }

    private void applyTemperature() {
        int selectedTemp = temperatureSeekBar.getProgress();
        
        database.saveLocationTemperature(
            new TemperatureDatabase.LocationTemp(selectedLocation, selectedTemp, true)
        );
        
        arduino.sendTemperature(selectedLocation, selectedTemp);
        
        Toast.makeText(this, "Temperature: " + selectedTemp + "°C for " + selectedLocation, 
            Toast.LENGTH_SHORT).show();
    }

    private void setupArduinoListener() {
        arduino.setListener(new ArduinoCommunication.ArduinoResponseListener() {
            @Override
            public void onSuccess(String response) {
                Toast.makeText(MainActivity.this, "Success: " + response, Toast.LENGTH_SHORT).show();
            }

            @Override
            public void onError(String error) {
                Toast.makeText(MainActivity.this, "Error: " + error, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
