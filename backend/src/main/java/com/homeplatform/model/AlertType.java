package com.homeplatform.model;

import com.homeplatform.model.Notification.Category;

/**
 * Every kind of alert the app sends, which members can turn on or off (and choose
 * whether it reaches their phone) under Profile → Alert types. The defaults are what
 * happened before there were settings: everything in the Alerts list, and camera
 * alerts plus Roomba errors on the phone. Weather alerts came later and are opt-in
 * (Profile → Weather alerts).
 */
public enum AlertType {
    PERSON_DETECTED(Category.CAMERA, "Person outside", "Someone seen by an outdoor camera", true, true),
    INDOOR_PERSON(Category.CAMERA, "Person inside while away", "The indoor camera sees someone while everyone's phone is away", true, true),
    INDOOR_NOISE(Category.CAMERA, "Noise while away", "A few minutes of sound at the indoor camera while everyone's away", true, true),
    CAMERA_BATTERY(Category.CAMERA, "Camera battery low", "An outdoor camera at 30% or less and not charging", true, true),
    CAMERA_NOT_CHARGING(Category.CAMERA, "Camera not charging", "No solar charge after two sunny days", true, true),
    CAMERA_OFFLINE(Category.CAMERA, "Camera offline", "A camera unreachable for 30 minutes", true, true),
    ROOMBA_ERROR(Category.ROOMBA, "Roomba error", "The Roomba stopped with an error", true, true),
    ROOMBA_ATTENTION(Category.ROOMBA, "Roomba needs attention", "Bin full, stuck, or battery low", true, false),
    ROOMBA_DONE(Category.ROOMBA, "Cleaning complete", "A cleaning run finished", true, false),
    ENERGY_DAILY(Category.ELECTRICAL, "Daily usage report", "Yesterday's electricity use", true, false),
    ENERGY_SPIKE(Category.ELECTRICAL, "Usage spikes", "A day 30% above average, or an hour over 5 kWh", true, false),
    ENERGY_BILL(Category.ELECTRICAL, "Monthly bill estimate", "Early each month", true, false),
    // Weather alerts are off until a member turns them on, each with its own times and
    // limit (WeatherAlertRule). Turning one on sends it to the phone too.
    WEATHER_RAIN(Category.WEATHER, "Rain", "Rain likely in the hours you pick, e.g. overnight, so you can pause the sprinklers", false, true),
    WEATHER_NWS(Category.WEATHER, "Weather warnings", "Official National Weather Service warnings for home, as soon as they're issued", false, true),
    WEATHER_STORMS(Category.WEATHER, "Thunderstorms", "Thunderstorms in the forecast", false, true),
    WEATHER_FREEZE(Category.WEATHER, "Freeze", "Temperatures at or below your limit: pipes, plants, sprinklers", false, true),
    WEATHER_HEAT(Category.WEATHER, "Extreme heat", "A high at or above your limit", false, true),
    WEATHER_WIND(Category.WEATHER, "High wind", "Gusts at or above your limit", false, true),
    WEATHER_WINTER(Category.WEATHER, "Snow or ice", "Snow, sleet or freezing rain in the forecast", false, true),
    // Household reminders (the Reminders page): on by default, phone too, because a reminder
    // with alerts turned on is an explicit ask. Each reminder can also turn its alerts off.
    REMINDER(Category.REMINDER, "Reminders", "Heads-ups for household reminders, like trash day", true, true);

    private final Category category;
    private final String label;
    private final String description;
    private final boolean defaultInApp;
    private final boolean defaultPush;

    AlertType(Category category, String label, String description, boolean defaultInApp, boolean defaultPush) {
        this.category = category;
        this.label = label;
        this.description = description;
        this.defaultInApp = defaultInApp;
        this.defaultPush = defaultPush;
    }

    public Category category() { return category; }
    public String label() { return label; }
    public String description() { return description; }
    public boolean defaultInApp() { return defaultInApp; }
    public boolean defaultPush() { return defaultPush; }
}
