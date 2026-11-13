package com.homeplatform.service;

/**
 * The words for what the Roomba's dock is complaining about, for the attention reasons and the
 * alerts. The poller decodes the dock's codes into a kind (roomba-poller/dock_issues.py, which
 * has the code table and its sources); the Roomba page words the same kinds in
 * frontend/src/utils/roombaStatus.ts. A kind this doesn't know reads as "needs attention" with
 * the code, never as fine.
 *
 * 671 and 672 are iRobot's "empty or not installed" / "full or not installed": the dock can't
 * tell an empty tank from one that isn't pushed in, so for those the advice covers both.
 */
public final class RoombaDock {

    public static final String CLEAN_WATER_EMPTY = "clean_water_empty";
    public static final String CLEAN_WATER_OUT = "clean_water_out";
    public static final String DIRTY_WATER_FULL = "dirty_water_full";
    public static final String DIRTY_WATER_OUT = "dirty_water_out";
    public static final String BAG = "bag";
    public static final String MOP = "mop";

    private RoombaDock() {}

    /** The attention reason: "The dock's clean-water tank is empty". */
    public static String reason(String kind, Integer code) {
        if (kind == null) return null;
        return switch (kind) {
            case CLEAN_WATER_EMPTY -> "The dock's clean-water tank is empty";
            case CLEAN_WATER_OUT -> "The dock's clean-water tank is out";
            case DIRTY_WATER_FULL -> "The dock's dirty-water tank is full";
            case DIRTY_WATER_OUT -> "The dock's dirty-water tank is out";
            case BAG -> "The dock needs a new bag";
            case MOP -> "The mop isn't attached";
            default -> code != null ? "The dock needs attention (code " + code + ")" : "The dock needs attention";
        };
    }

    /** What to do about it, naming the robot. */
    public static String fix(String kind, Integer code, String robotName) {
        String name = robotName != null && !robotName.isBlank() ? robotName.trim() : "the Roomba";
        if (kind == null) return null;
        return switch (kind) {
            case CLEAN_WATER_EMPTY -> "Refill it and " + name + " can mop again."
                    + (Integer.valueOf(671).equals(code) ? " If it's full, push it in firmly; a loose tank reads as empty." : "");
            case CLEAN_WATER_OUT -> "Fill it and put it back, and " + name + " can mop again.";
            case DIRTY_WATER_FULL -> "Empty it and " + name + " can mop again."
                    + (Integer.valueOf(672).equals(code) ? " If it's empty, push it in firmly; a loose tank reads as full." : "");
            case DIRTY_WATER_OUT -> "Put it back and " + name + " can mop again.";
            case BAG -> "Fit one so the dock can empty " + name + "'s bin again.";
            case MOP -> "Attach or reseat it and " + name + " can mop again. It can still vacuum.";
            default -> (code != null ? "The dock reported code " + code + ", which this app can't read yet. "
                                     : "The dock reported something this app can't read yet. ")
                    + "Check the light on the dock and the iRobot app.";
        };
    }

    /** The alert's title: stable per kind, so one occurrence is one alert. */
    public static String alertTitle(String kind) {
        if (kind == null) return null;
        return switch (kind) {
            case CLEAN_WATER_EMPTY -> "Roomba dock — clean-water tank empty";
            case CLEAN_WATER_OUT -> "Roomba dock — clean-water tank out";
            case DIRTY_WATER_FULL -> "Roomba dock — dirty-water tank full";
            case DIRTY_WATER_OUT -> "Roomba dock — dirty-water tank out";
            case BAG -> "Roomba dock — needs a new bag";
            case MOP -> "Roomba — mop not attached";
            default -> "Roomba dock needs attention";
        };
    }

    /** The alert's text: what's wrong, what to do, and the dock's code. */
    public static String alertMessage(String kind, Integer code, String robotName) {
        if (kind == null) return null;
        if (!isKnown(kind)) return fix(kind, code, robotName);
        return reason(kind, code) + ". " + fix(kind, code, robotName) + (code != null ? " Dock code " + code + "." : "");
    }

    static boolean isKnown(String kind) {
        return switch (kind) {
            case CLEAN_WATER_EMPTY, CLEAN_WATER_OUT, DIRTY_WATER_FULL, DIRTY_WATER_OUT, BAG, MOP -> true;
            default -> false;
        };
    }
}
