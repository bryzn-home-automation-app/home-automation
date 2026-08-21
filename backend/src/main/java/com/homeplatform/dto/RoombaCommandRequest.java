package com.homeplatform.dto;

/** Enqueue a control command. {@code arg} carries the favorite id for command="favorite". */
public record RoombaCommandRequest(String command, String arg) {}
