// app/page.js
"use client";

import { useEffect, useRef, useState } from "react";
import { setCookie, getCookie } from "cookies-next";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export default function HomePage() {
  const sdkRef = useRef(null);

  const [sdkReady, setSdkReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [deviceIdLoading, setDeviceIdLoading] = useState(false);

  const [deviceToken, setDeviceToken] = useState("");
  const [deviceEncryptionKey, setDeviceEncryptionKey] = useState("");

  const [loginResult, setLoginResult] = useState(null);
  const [loginError, setLoginError] = useState(null);

  const [challengeId, setChallengeId] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [usdcBalance, setUsdcBalance] = useState(null);
  const [status, setStatus] = useState("Ready");

  // Initialize SDK on mount, using cookies to restore config after redirect
  useEffect(() => {
    let cancelled = false;

    const initSdk = async () => {
      try {
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");

        const onLoginComplete = (error, result) => {
          if (cancelled) return;

          if (error) {
            const err = error;
            console.log("Login failed:", err);
            setLoginError(err.message || "Login failed");
            setLoginResult(null);
            setStatus("Login failed");
            return;
          }

          setLoginResult({
            userToken: result.userToken,
            encryptionKey: result.encryptionKey,
          });
          setLoginError(null);
          setStatus("Login successful. Credentials received from Google.");
        };

        const restoredAppId = getCookie("appId") || appId || "";
        const restoredGoogleClientId =
          getCookie("google.clientId") || googleClientId || "";
        const restoredDeviceToken = getCookie("deviceToken") || "";
        const restoredDeviceEncryptionKey =
          getCookie("deviceEncryptionKey") || "";

        const initialConfig = {
          appSettings: { appId: restoredAppId },
          loginConfigs: {
            deviceToken: restoredDeviceToken,
            deviceEncryptionKey: restoredDeviceEncryptionKey,
            google: {
              clientId: restoredGoogleClientId,
              redirectUri:
                typeof window !== "undefined" ? window.location.origin : "",
              selectAccountPrompt: true,
            },
          },
        };

        const sdk = new W3SSdk(initialConfig, onLoginComplete);
        sdkRef.current = sdk;

        if (!cancelled) {
          setSdkReady(true);
          setStatus("SDK initialized. Ready to create device token.");
        }
      } catch (err) {
        console.log("Failed to initialize Web SDK:", err);
        if (!cancelled) {
          setStatus("Failed to initialize Web SDK");
        }
      }
    };

    void initSdk();

    return () => {
      cancelled = true;
    };
  }, []);

  // Get / cache deviceId
  useEffect(() => {
    const fetchDeviceId = async () => {
      if (!sdkRef.current) return;

      try {
        const cached =
          typeof window !== "undefined"
            ? window.localStorage.getItem("deviceId")
            : null;

        if (cached) {
          setDeviceId(cached);
          return;
        }

        setDeviceIdLoading(true);
        const id = await sdkRef.current.getDeviceId();
        setDeviceId(id);

        if (typeof window !== "undefined") {
          window.localStorage.setItem("deviceId", id);
        }
      } catch (error) {
        console.log("Failed to get deviceId:", error);
        setStatus("Failed to get deviceId");
      } finally {
        setDeviceIdLoading(false);
      }
    };

    if (sdkReady) {
      void fetchDeviceId();
    }
  }, [sdkReady]);

  // Helper to load USDC balance for a wallet
  async function loadUsdcBalance(userToken, walletId) {
    try {
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "getTokenBalance",
          userToken,
          walletId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.log("Failed to load USDC balance:", data);
        setStatus("Failed to load USDC balance");
        return null;
      }

      const balances = data.tokenBalances || [];

      const usdcEntry =
        balances.find((t) => {
          const symbol = t.token?.symbol || "";
          const name = t.token?.name || "";
          return symbol.startsWith("USDC") || name.includes("USDC");
        }) ?? null;

      const amount = usdcEntry?.amount ?? "0";
      setUsdcBalance(amount);
      return amount;
    } catch (err) {
      console.log("Failed to load USDC balance:", err);
      setStatus("Failed to load USDC balance");
      return null;
    }
  }

  // Helper to load wallets for the current user
  const loadWallets = async (userToken, options) => {
    try {
      setStatus("Loading wallet details...");
      setUsdcBalance(null);

      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "listWallets",
          userToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.log("List wallets failed:", data);
        setStatus("Failed to load wallet details");
        return;
      }

      const wallets = data.wallets || [];
      setWallets(wallets);

      if (wallets.length > 0) {
        // Load USDC balance for the primary wallet
        await loadUsdcBalance(userToken, wallets[0].id);

        if (options?.source === "afterCreate") {
          setStatus(
            "Wallet created successfully! 🎉 Wallet details and USDC balance loaded.",
          );
        } else if (options?.source === "alreadyInitialized") {
          setStatus(
            "User already initialized. Wallet details and USDC balance loaded.",
          );
        } else {
          setStatus("Wallet details and USDC balance loaded.");
        }
      } else {
        setStatus("No wallets found for this user.");
      }
    } catch (err) {
      console.log("Failed to load wallet details:", err);
      setStatus("Failed to load wallet details");
    }
  };

  const handleCreateDeviceToken = async () => {
    if (!deviceId) {
      setStatus("Missing deviceId");
      return;
    }

    try {
      setStatus("Creating device token...");
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createDeviceToken",
          deviceId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.log("Create device token failed:", data);
        setStatus("Failed to create device token");
        return;
      }

      setDeviceToken(data.deviceToken);
      setDeviceEncryptionKey(data.deviceEncryptionKey);

      setCookie("deviceToken", data.deviceToken);
      setCookie("deviceEncryptionKey", data.deviceEncryptionKey);

      setStatus("Device token created");
    } catch (err) {
      console.log("Error creating device token:", err);
      setStatus("Failed to create device token");
    }
  };

  const handleLoginWithGoogle = () => {
    const sdk = sdkRef.current;
    if (!sdk) {
      setStatus("SDK not ready");
      return;
    }

    if (!deviceToken || !deviceEncryptionKey) {
      setStatus("Missing deviceToken or deviceEncryptionKey");
      return;
    }

    // Persist configs so SDK can rehydrate after redirect
    setCookie("appId", appId);
    setCookie("google.clientId", googleClientId);
    setCookie("deviceToken", deviceToken);
    setCookie("deviceEncryptionKey", deviceEncryptionKey);

    sdk.updateConfigs({
      appSettings: {
        appId,
      },
      loginConfigs: {
        deviceToken,
        deviceEncryptionKey,
        google: {
          clientId: googleClientId,
          redirectUri: window.location.origin,
          selectAccountPrompt: true,
        },
      },
    });

    setStatus("Redirecting to Google...");
    sdk.performLogin(SocialLoginProvider.GOOGLE);
  };

  const handleInitializeUser = async () => {
    if (!loginResult?.userToken) {
      setStatus("Missing userToken. Please login with Google first.");
      return;
    }

    try {
      setStatus("Initializing user...");

      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "initializeUser",
          userToken: loginResult.userToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // 155106 = user already initialized
        if (data.code === 155106) {
          // User already initialized; load wallet details instead of trying to create again
          await loadWallets(loginResult.userToken, {
            source: "alreadyInitialized",
          });
          // No challenge to execute when wallet already exists
          setChallengeId(null);
          return;
        }

        const errorMsg = data.code
          ? `[${data.code}] ${data.error || data.message}`
          : data.error || data.message;
        setStatus("Failed to initialize user: " + errorMsg);
        return;
      }

      // Successful initialization → get challengeId
      setChallengeId(data.challengeId);
      setStatus(`User initialized. challengeId: ${data.challengeId}`);
    } catch (err) {
      const error = err;

      if (error?.code === 155106 && loginResult?.userToken) {
        await loadWallets(loginResult.userToken, {
          source: "alreadyInitialized",
        });
        setChallengeId(null);
        return;
      }

      const errorMsg = error?.code
        ? `[${error.code}] ${error.message}`
        : error?.message || "Unknown error";
      setStatus("Failed to initialize user: " + errorMsg);
    }
  };

  const handleExecuteChallenge = () => {
    const sdk = sdkRef.current;
    if (!sdk) {
      setStatus("SDK not ready");
      return;
    }

    if (!challengeId) {
      setStatus("Missing challengeId. Initialize user first.");
      return;
    }

    if (!loginResult?.userToken || !loginResult?.encryptionKey) {
      setStatus("Missing login credentials. Please login again.");
      return;
    }

    sdk.setAuthentication({
      userToken: loginResult.userToken,
      encryptionKey: loginResult.encryptionKey,
    });

    setStatus("Executing challenge...");

    sdk.execute(challengeId, (error) => {
      const err = error || {};

      if (error) {
        console.log("Execute challenge failed:", err);
        setStatus(
          "Failed to execute challenge: " + (err?.message ?? "Unknown error"),
        );
        return;
      }

      setStatus("Challenge executed. Loading wallet details...");

      void (async () => {
        // small delay to give Circle time to index the wallet
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Challenge consumed; clear it and load wallet details (and balance)
        setChallengeId(null);
        await loadWallets(loginResult.userToken, { source: "afterCreate" });
      })().catch((e) => {
        console.log("Post-execute follow-up failed:", e);
        setStatus("Wallet created, but failed to load wallet details.");
      });
    });
  };

  const primaryWallet = wallets[0];

  return (
    <main>
      <div style={{ width: "50%", margin: "0 auto" }}>
        <h1>Create a user wallet with Google social login</h1>
        <p>Follow the buttons below to complete the flow:</p>

        <div>
          <button
            onClick={handleCreateDeviceToken}
            style={{ margin: "6px" }}
            disabled={!sdkReady || !deviceId || deviceIdLoading}
          >
            1. Create device token
          </button>
          <br />
          <button
            onClick={handleLoginWithGoogle}
            style={{ margin: "6px" }}
            disabled={!deviceToken || !deviceEncryptionKey}
          >
            2. Login with Google
          </button>
          <br />
          <button
            onClick={handleInitializeUser}
            style={{ margin: "6px" }}
            disabled={!loginResult || wallets.length > 0}
          >
            3. Initialize user (get challenge)
          </button>
          <br />
          <button
            onClick={handleExecuteChallenge}
            style={{ margin: "6px" }}
            disabled={!challengeId || wallets.length > 0}
          >
            4. Create wallet (execute challenge)
          </button>
        </div>

        <p>
          <strong>Status:</strong> {status}
        </p>

        {loginError && (
          <p style={{ color: "red" }}>
            <strong>Error:</strong> {loginError}
          </p>
        )}

        {primaryWallet && (
          <div style={{ marginTop: "12px" }}>
            <h2>Wallet details</h2>
            <p>
              <strong>Address:</strong> {primaryWallet.address}
            </p>
            <p>
              <strong>Blockchain:</strong> {primaryWallet.blockchain}
            </p>
            {usdcBalance !== null && (
              <p>
                <strong>USDC balance:</strong> {usdcBalance}
              </p>
            )}
          </div>
        )}

        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            lineHeight: "1.8",
            marginTop: "16px",
          }}
        >
          {JSON.stringify(
            {
              deviceId,
              deviceToken,
              deviceEncryptionKey,
              userToken: loginResult?.userToken,
              encryptionKey: loginResult?.encryptionKey,
              challengeId,
              wallets,
              usdcBalance,
            },
            null,
            2,
          )}
        </pre>
      </div>
    </main>
  );
}