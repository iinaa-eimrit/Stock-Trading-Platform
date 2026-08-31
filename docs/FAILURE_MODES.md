# Exchange Architecture Failure Modes

This document outlines the expected behavior of the exchange architecture under various operational failure conditions. Our design leverages a "Journal-first + idempotent settlement" model to ensure absolute determinism and correct crash recovery.

| Failure                   | Expected behavior            |
| ------------------------- | ---------------------------- |
| Journal write fails       | process fails closed         |
| Journal corruption        | recovery refuses to continue |
| PostgreSQL unavailable    | journal backlog retained     |
| DB transaction rolls back | event remains retryable      |
| Crash after DB commit     | retry is idempotent          |
| Duplicate client order    | original result returned     |
| Crash during recovery     | replay remains deterministic |
