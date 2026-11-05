package com.homeplatform.service;

import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.repository.NotificationRepository;
import com.homeplatform.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** An expired Gmail sign-in reaches the admins instead of only the Debug page. */
class WaterBillSyncSchedulerTest {

    private UserRepository users;
    private NotificationRepository notifications;
    private NotificationService notificationService;

    @BeforeEach
    void setUp() {
        users = mock(UserRepository.class);
        notifications = mock(NotificationRepository.class);
        notificationService = mock(NotificationService.class);
        User admin = new User();
        admin.setId(1L);
        when(users.findByRoleAndStatus(User.Role.ADMIN, User.AccountStatus.ACTIVE)).thenReturn(List.of(admin));
    }

    private WaterBillSyncScheduler scheduler(int exit, String output) {
        return new WaterBillSyncScheduler(mock(AppEventService.class), users, notifications, notificationService) {
            @Override
            int spawn(List<String> command, StringBuilder out) {
                out.append(output);
                return exit;
            }
        };
    }

    @Test
    @DisplayName("invalid_grant → one WARNING to each admin, with the fix")
    void invalidGrantNotifiesAdmins() {
        scheduler(1, "❌  Gmail fetch failed: invalid_grant\n").runWaterBillSync();
        verify(notificationService).create(eq(1L), eq(Category.WATER), eq(Severity.WARNING),
                eq(WaterBillSyncScheduler.GMAIL_EXPIRED_TITLE), contains("gmail-authorize.js"));
    }

    @Test
    @DisplayName("already told this week → no repeat")
    void dedupedWithinAWeek() {
        when(notifications.existsByUserIdAndCategoryAndTitleAndCreatedAtAfter(
                eq(1L), eq(Category.WATER), eq(WaterBillSyncScheduler.GMAIL_EXPIRED_TITLE), any(LocalDateTime.class)))
                .thenReturn(true);
        scheduler(1, "Gmail fetch failed: invalid_grant").runWaterBillSync();
        verify(notificationService, never()).create(anyLong(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("other failures don't claim Gmail expired")
    void otherFailuresStayOnDebugPage() {
        scheduler(1, "PDF parse error").runWaterBillSync();
        verify(notificationService, never()).create(anyLong(), any(), any(), any(), any());
        assertEquals(2, WaterBillSyncScheduler.parseWritten("2 row(s) written"));
    }
}
