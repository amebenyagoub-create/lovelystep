/** @param {string} connectionString */
export function postgresConnectionOptions(connectionString) {
  const ca = process.env.DATABASE_CA_CERT?.trim().replaceAll("\\n", "\n");
  if (!ca) {
    return {
      connectionString,
      ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
    };
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL doit être une URI PostgreSQL valide.");
  }
  // node-postgres gives TLS parameters in the URL precedence over the ssl object.
  for (const parameter of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    url.searchParams.delete(parameter);
  }
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}
