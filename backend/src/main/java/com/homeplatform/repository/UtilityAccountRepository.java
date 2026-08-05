package com.homeplatform.repository;

import com.homeplatform.model.UtilityAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UtilityAccountRepository extends JpaRepository<UtilityAccount, Long> {

    List<UtilityAccount> findByProviderId(Long providerId);

    Optional<UtilityAccount> findByAccountNumber(String accountNumber);

    List<UtilityAccount> findByStatus(String status);
}
