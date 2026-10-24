package com.homeplatform.service;

import com.homeplatform.dto.TabUsageResponse;
import com.homeplatform.model.TabActivity;
import com.homeplatform.model.User;
import com.homeplatform.repository.TabActivityRepository;
import com.homeplatform.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

class TabActivityServiceTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 10, 24, 12, 0);

    private TabActivityRepository repo;
    private UserRepository users;
    private TabActivityService service;

    @BeforeEach
    void setUp() {
        repo = mock(TabActivityRepository.class);
        users = mock(UserRepository.class);
        service = new TabActivityService(repo, users, Clock.fixed(NOW.toInstant(ZoneOffset.UTC), ZoneOffset.UTC));
    }

    @Test
    @DisplayName("records a member's visit with the tab and time")
    void records() {
        service.record(7L, "admin/debug", TabActivity.Kind.VIEW);
        ArgumentCaptor<TabActivity> saved = ArgumentCaptor.forClass(TabActivity.class);
        verify(repo).save(saved.capture());
        assertThat(saved.getValue().getUserId()).isEqualTo(7L);
        assertThat(saved.getValue().getTab()).isEqualTo("admin/debug");
        assertThat(saved.getValue().getAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("rejects anything that isn't a tab path")
    void rejectsJunk() {
        for (String bad : new String[]{null, "", "/cameras", "Cameras", "a/b/c", "x".repeat(41), "cameras?x=1"}) {
            assertThatThrownBy(() -> service.record(7L, bad, TabActivity.Kind.ACTIVE)).isInstanceOf(IllegalArgumentException.class);
        }
        verify(repo, never()).save(any());
    }

    @Test
    @DisplayName("rolls up visits and active minutes per member and tab, most used first, without guests")
    void usage() {
        when(repo.tally(NOW.minusDays(30))).thenReturn(List.of(
                tally(1L, "cameras", TabActivity.Kind.VIEW, 4, NOW.minusHours(1)),
                tally(1L, "cameras", TabActivity.Kind.ACTIVE, 12, NOW.minusHours(1)),
                tally(1L, "home", TabActivity.Kind.VIEW, 9, NOW.minusHours(3)),
                tally(1L, "home", TabActivity.Kind.ACTIVE, 3, NOW.minusHours(3)),
                tally(2L, "climate", TabActivity.Kind.ACTIVE, 40, NOW.minusDays(2)),
                tally(3L, "home", TabActivity.Kind.ACTIVE, 99, NOW)));
        when(users.findAllById(anyList())).thenReturn(List.of(
                user(1L, "bryan", User.Role.ADMIN), user(2L, "sam", User.Role.USER), user(3L, "visitor", User.Role.GUEST)));

        TabUsageResponse r = service.usage(null);

        assertThat(r.days()).isEqualTo(30);
        assertThat(r.members()).extracting(TabUsageResponse.Member::username).containsExactly("sam", "bryan");
        TabUsageResponse.Member bryan = r.members().get(1);
        assertThat(bryan.visits()).isEqualTo(13);
        assertThat(bryan.activeMinutes()).isEqualTo(15);
        assertThat(bryan.lastActiveAt()).isEqualTo(NOW.minusHours(1).toInstant(ZoneOffset.UTC));
        assertThat(bryan.tabs()).extracting(TabUsageResponse.TabTotal::tab).containsExactly("cameras", "home");
        assertThat(r.household()).containsExactly(
                new TabUsageResponse.TabTotal("climate", 0, 40),
                new TabUsageResponse.TabTotal("cameras", 4, 12),
                new TabUsageResponse.TabTotal("home", 9, 3));
    }

    @Test
    @DisplayName("clamps the range to 1..365 days")
    void clampsDays() {
        when(repo.tally(any())).thenReturn(List.of());
        when(users.findAllById(anyList())).thenReturn(List.of());
        assertThat(service.usage(0).days()).isEqualTo(1);
        assertThat(service.usage(10_000).days()).isEqualTo(365);
    }

    private static User user(Long id, String username, User.Role role) {
        User u = new User();
        u.setId(id);
        u.setUsername(username);
        u.setRole(role);
        return u;
    }

    private static TabActivityRepository.Tally tally(Long userId, String tab, TabActivity.Kind kind, long count, LocalDateTime last) {
        return new TabActivityRepository.Tally() {
            public Long getUserId() { return userId; }
            public String getTab() { return tab; }
            public TabActivity.Kind getKind() { return kind; }
            public long getCount() { return count; }
            public LocalDateTime getLast() { return last; }
        };
    }
}
