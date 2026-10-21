package com.homeplatform.dto;

/** A stored camera position: its slot and a display name ("Home", "Position 1"). */
public record CameraPreset(int index, String name) {}
