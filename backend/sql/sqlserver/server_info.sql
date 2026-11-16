-- Connectivity check for the Reports page: which server and database the app reached.
SELECT
    @@VERSION     AS version,
    DB_NAME()     AS database_name,
    SYSDATETIME() AS server_time
