const SSO_URL = "https://servis.cygnus2.cz/Cygnus2_SSO_NET";
const C2_URL = `${SSO_URL}/mobilni-cygnus`;

export class CygnusClient {
  constructor({ email, password, instanceName }) {
    this.email = email;
    this.password = password;
    this.instanceName = instanceName ?? null;
    this.authorizationToken = null;
  }

  async login() {
    const response = await fetchJson(`${SSO_URL}/log-on`, {
      method: "POST",
      body: {
        Email: this.email,
        Password: this.password,
      },
    });

    const result = response.LogOnResult;

    if (!result?.AuthorizationToken) {
      throw new Error("Cygnus vratil odpoved bez AuthorizationToken.");
    }

    this.authorizationToken = result.AuthorizationToken;

    if (!this.instanceName) {
      if (!Array.isArray(result.Instances) || result.Instances.length === 0) {
        throw new Error("Na konte nie je dostupna ziadna instancia.");
      }

      if (result.Instances.length > 1) {
        const available = result.Instances.map((instance) => instance.Nazev).join(", ");
        throw new Error(
          `Konto ma viac instancii. Spusti skript s --instance. Dostupne: ${available}`,
        );
      }

      this.instanceName = result.Instances[0].Nazev;
    }

    return {
      instanceName: this.instanceName,
      instances: result.Instances ?? [],
    };
  }

  async getMonthlyPlan(date) {
    return this.#request(
      `${C2_URL}/kalendar-zamestnance/get-mesicni-plan-new?datum=${date}`,
    );
  }

  async #request(url, { method = "GET", body } = {}, retry = true) {
    if (!this.authorizationToken) {
      await this.login();
    }

    const headers = {
      Accept: "application/json",
      Authorization: this.authorizationToken,
      "X-InstanceName": this.instanceName,
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && retry) {
      await this.login();
      return this.#request(url, { method, body }, false);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cygnus API chyba ${response.status}: ${errorText}`);
    }

    return response.json();
  }
}

async function fetchJson(url, { method = "GET", body } = {}) {
  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cygnus login chyba ${response.status}: ${errorText}`);
  }

  return response.json();
}
