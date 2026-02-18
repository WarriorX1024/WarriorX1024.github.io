package com.actemperature.control;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;

public class TemperatureDatabase {
    private static final String PREF_NAME = "AC_TEMP_DB";
    private static final String KEY_LOCATIONS = "locations_data";
    private SharedPreferences preferences;
    private Gson gson;

    public TemperatureDatabase(Context context) {
        this.preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        this.gson = new Gson();
    }

    public static class LocationTemp {
        public String locationName;
        public int temperature;
        public boolean active;

        public LocationTemp(String locationName, int temperature, boolean active) {
            this.locationName = locationName;
            this.temperature = temperature;
            this.active = active;
        }
    }

    public void saveLocationTemperature(LocationTemp locationTemp) {
        List<LocationTemp> locations = getAllLocations();
        
        // Check if location already exists and update
        boolean found = false;
        for (int i = 0; i < locations.size(); i++) {
            if (locations.get(i).locationName.equals(locationTemp.locationName)) {
                locations.set(i, locationTemp);
                found = true;
                break;
            }
        }
        
        if (!found) {
            locations.add(locationTemp);
        }
        
        String json = gson.toJson(locations);
        preferences.edit().putString(KEY_LOCATIONS, json).apply();
    }

    public List<LocationTemp> getAllLocations() {
        String json = preferences.getString(KEY_LOCATIONS, "[]");
        Type type = new TypeToken<List<LocationTemp>>() {}.getType();
        List<LocationTemp> result = gson.fromJson(json, type);
        return result != null ? result : new ArrayList<>();
    }

    public LocationTemp getLocationTemperature(String locationName) {
        List<LocationTemp> locations = getAllLocations();
        for (LocationTemp loc : locations) {
            if (loc.locationName.equals(locationName)) {
                return loc;
            }
        }
        return null;
    }

    public void deleteLocation(String locationName) {
        List<LocationTemp> locations = getAllLocations();
        locations.removeIf(loc -> loc.locationName.equals(locationName));
        String json = gson.toJson(locations);
        preferences.edit().putString(KEY_LOCATIONS, json).apply();
    }
}
