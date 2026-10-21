package com.homeplatform.model;

import com.homeplatform.model.Notification.Category;

/**
 * Every kind of alert the app sends, which members can turn on or off (and choose
 * whether it reaches their phone) under Profile → Alert types. The defaults are what
 * happened before there were settings: everything in the Alerts list, and camera
 * alerts plus Roomba errors on the phone.
 */
public enum AlertType {
    PERSON_DETECTED(Category.CAMERA, "Person outside", "Someone seen by an outdoor camera", true, true),
    CAMERA_BATTERY(Category.CAMERA, "Camera battery low", "An outdoor camera at 30% or less and not charging", true, true),
    CAMERA_NOT_CHARGING(Category.CAMERA, "Camera not charging", "No solar charge after two sunny days", true, true),
    CAMERA_OFFLINE(Category.CAMERA, "Camera offline", "A camera unreachable for 30 minutes", true, true),
    ROOMBA_ERROR(Category.ROOMBA, "Roomba error", "The Roomba stopped with an error", true, true),
    ROOMBA_ATTENTION(Category.ROOMBA, "Roomba needs attention", "Bin full, stuck, or battery low", true, false),
    ROOMBA_DONE(Category.ROOMBA, "Cleaning complete", "A cleaning run finished", true, false),
    ENERGY_DAILY(Category.ELECTRICAL, "Daily usage report", "Yesterday's electricity use", true, false),
    ENERGY_SPIKE(Category.ELECTRICAL, "Usage spikes", "A day 30% above average, or an hour over 5 kWh", true, false),
    ENERGY_BILL(Category.ELECTRICAL, "Monthly bill estimate", "Early each month", true, false);

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
