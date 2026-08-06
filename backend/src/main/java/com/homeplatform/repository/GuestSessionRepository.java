package com.homeplatform.repository;

import com.homeplatform.model.GuestSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface GuestSessionRepository extends JpaRepository<GuestSession, Long> {

    List<GuestSession> findByStatus(GuestSession.Status status);

    List<GuestSession> findByUserIdAndStatus(Long userId, GuestSession.Status status);

    Optional<GuestSession> findTopByUserIdOrderByConnectedAtDesc(Long userId);

    long countByStatus(GuestSession.Status status);

    void deleteByExpiresAtBefore(LocalDateTime dateTime);
}
