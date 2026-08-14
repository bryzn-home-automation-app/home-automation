package com.homeplatform.dto;

/**
 * Optional date range for a manual sync trigger.
 * Dates are ISO {@code yyyy-MM-dd}. When omitted (or both null), the trigger
 * syncs yesterday — matching the scheduler's default behavior.
 */
public class SyncRangeRequest {

    private String startDate;
    private String endDate;

    public SyncRangeRequest() {}

    public String getStartDate() { return startDate; }
    public void setStartDate(String startDate) { this.startDate = startDate; }
    public String getEndDate() { return endDate; }
    public void setEndDate(String endDate) { this.endDate = endDate; }
}
