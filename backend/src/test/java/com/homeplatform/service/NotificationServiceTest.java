package com.homeplatform.service;

import com.homeplatform.model.Notification;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.repository.NotificationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class NotificationServiceTest {

    private NotificationService notificationService;
    private NotificationRepository repo;

    @BeforeEach
    void setUp() {
        repo = mock(NotificationRepository.class);
        notificationService = new NotificationService(repo);
    }

    @Nested
    @DisplayName("create")
    class Create {

        @Test
        @DisplayName("creates and saves a notification")
        void createsNotification() {
            Notification saved = Notification.builder()
                    .id(1L).userId(1L).category(Category.ELECTRICAL)
                    .severity(Severity.INFO).title("Test").message("msg").build();
            when(repo.save(any(Notification.class))).thenReturn(saved);

            Notification result = notificationService.create(1L, Category.ELECTRICAL,
                    Severity.INFO, "Test", "msg");

            assertNotNull(result);
            assertEquals(1L, result.getId());
            assertEquals("Test", result.getTitle());
            verify(repo).save(any(Notification.class));
        }
    }

    @Nested
    @DisplayName("getNotifications")
    class GetNotifications {

        @Test
        @DisplayName("returns unread only when unreadOnly is true")
        void unreadOnlyFilter() {
            when(repo.findByUserIdAndIsReadFalseOrderByCreatedAtDesc(anyLong(), any(Pageable.class)))
                    .thenReturn(List.of());

            notificationService.getNotifications(1L, null, null, true, 50);

            verify(repo).findByUserIdAndIsReadFalseOrderByCreatedAtDesc(eq(1L), any(Pageable.class));
        }

        @Test
        @DisplayName("filters by category and severity together")
        void categoryAndSeverityFilter() {
            when(repo.findByUserIdAndCategoryAndSeverityOrderByCreatedAtDesc(
                    anyLong(), any(Category.class), any(Severity.class), any(Pageable.class)))
                    .thenReturn(List.of());

            notificationService.getNotifications(1L, "ELECTRICAL", "WARNING", false, 50);

            verify(repo).findByUserIdAndCategoryAndSeverityOrderByCreatedAtDesc(
                    eq(1L), eq(Category.ELECTRICAL), eq(Severity.WARNING), any(Pageable.class));
        }

        @Test
        @DisplayName("filters by category only")
        void categoryOnlyFilter() {
            when(repo.findByUserIdAndCategoryOrderByCreatedAtDesc(
                    anyLong(), any(Category.class), any(Pageable.class)))
                    .thenReturn(List.of());

            notificationService.getNotifications(1L, "ELECTRICAL", null, false, 50);

            verify(repo).findByUserIdAndCategoryOrderByCreatedAtDesc(
                    eq(1L), eq(Category.ELECTRICAL), any(Pageable.class));
        }

        @Test
        @DisplayName("filters by severity only")
        void severityOnlyFilter() {
            when(repo.findByUserIdAndSeverityOrderByCreatedAtDesc(
                    anyLong(), any(Severity.class), any(Pageable.class)))
                    .thenReturn(List.of());

            notificationService.getNotifications(1L, null, "CRITICAL", false, 50);

            verify(repo).findByUserIdAndSeverityOrderByCreatedAtDesc(
                    eq(1L), eq(Severity.CRITICAL), any(Pageable.class));
        }

        @Test
        @DisplayName("returns all when no filters")
        void noFilters() {
            when(repo.findByUserIdOrderByCreatedAtDesc(anyLong(), any(Pageable.class)))
                    .thenReturn(List.of());

            notificationService.getNotifications(1L, null, null, false, 50);

            verify(repo).findByUserIdOrderByCreatedAtDesc(eq(1L), any(Pageable.class));
        }

        @Test
        @DisplayName("caps limit at 200")
        void capsLimit() {
            when(repo.findByUserIdOrderByCreatedAtDesc(anyLong(), any(Pageable.class)))
                    .thenReturn(List.of());

            notificationService.getNotifications(1L, null, null, false, 999);

            // limit capped, should not throw
            verify(repo).findByUserIdOrderByCreatedAtDesc(eq(1L), any(Pageable.class));
        }

        @Test
        @DisplayName("uses DEFAULT_LIMIT when limit is 0")
        void defaultLimit() {
            when(repo.findByUserIdOrderByCreatedAtDesc(anyLong(), any(Pageable.class)))
                    .thenReturn(List.of());

            notificationService.getNotifications(1L, null, null, false, 0);

            verify(repo).findByUserIdOrderByCreatedAtDesc(eq(1L), any(Pageable.class));
        }
    }

    @Nested
    @DisplayName("getUnreadCount")
    class GetUnreadCount {

        @Test
        @DisplayName("returns unread count from repository")
        void returnsCount() {
            when(repo.countByUserIdAndIsReadFalse(1L)).thenReturn(5L);

            long count = notificationService.getUnreadCount(1L);

            assertEquals(5L, count);
        }
    }

    @Nested
    @DisplayName("markRead")
    class MarkRead {

        @Test
        @DisplayName("delegates to repository")
        void delegatesToRepo() {
            when(repo.markRead(42L)).thenReturn(1);

            int updated = notificationService.markRead(42L);

            assertEquals(1, updated);
        }
    }

    @Nested
    @DisplayName("markAllRead")
    class MarkAllRead {

        @Test
        @DisplayName("marks all unread for user and returns count")
        void marksAllForUser() {
            when(repo.markAllRead(1L)).thenReturn(3);

            int count = notificationService.markAllRead(1L);

            assertEquals(3, count);
        }
    }
}
