package com.homeplatform.repository;

import com.homeplatform.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);

    Optional<User> findByEmail(String email);

    Optional<User> findByDisplayName(String displayName);

    boolean existsByUsername(String username);

    boolean existsByEmail(String email);

    List<User> findByRole(User.Role role);

    List<User> findByStatus(User.AccountStatus status);

    List<User> findByRoleAndStatus(User.Role role, User.AccountStatus status);

    long countByRole(User.Role role);

    long countByStatus(User.AccountStatus status);
}
