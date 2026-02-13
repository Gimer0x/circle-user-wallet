// app/page.js
"use client";

import { useEffect, useRef, useState } from "react";
import { setCookie, getCookie, deleteCookie } from "cookies-next";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

export default function HomePage() {
  const sdkRef = useRef(null);
  const postLoginFlowRef = useRef(null);
  const refreshDeviceTokenRef = useRef(null);

  const [sdkReady, setSdkReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [deviceIdLoading, setDeviceIdLoading] = useState(false);

  const [deviceToken, setDeviceToken] = useState("");
  const [deviceEncryptionKey, setDeviceEncryptionKey] = useState("");

  const [loginResult, setLoginResult] = useState(null);
  const [loginError, setLoginError] = useState(null);

  const [wallets, setWallets] = useState([]);
  const [usdcBalance, setUsdcBalance] = useState(null);
  const [status, setStatus] = useState("Ready");

  // Mint contract execution
  const [mintReceiver, setMintReceiver] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [mintLoading, setMintLoading] = useState(false);

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
            const msg = err?.message || "Login failed";
            const code = err?.code;
            console.log("Login failed:", err);

            const isDeviceTokenInvalid =
              typeof msg === "string" &&
              msg.toLowerCase().includes("device token") &&
              msg.toLowerCase().includes("invalid");
            const isInvalidCredentials = code === 155140;

            if (isDeviceTokenInvalid || isInvalidCredentials) {
              setLoginError(null);
              setStatus(
                isInvalidCredentials
                  ? "Invalid credentials. Refreshing session..."
                  : "Device token invalid. Refreshing...",
              );
              refreshDeviceTokenRef.current?.();
              return;
            }

            setLoginError(msg);
            setLoginResult(null);
            setStatus("Login failed");
            return;
          }

          setLoginResult({
            userToken: result.userToken,
            encryptionKey: result.encryptionKey,
          });
          setLoginError(null);
          setStatus("Setting up your wallet...");
          postLoginFlowRef.current?.(result.userToken, result.encryptionKey);
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
          setStatus("Initializing...");
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

  // Get deviceId and ensure device token exists (auto-create or restore from cookies)
  useEffect(() => {
    const ensureDeviceToken = async () => {
      if (!sdkRef.current) return;

      try {
        const cached =
          typeof window !== "undefined"
            ? window.localStorage.getItem("deviceId")
            : null;

        let id = cached;
        if (!id) {
          setDeviceIdLoading(true);
          id = await sdkRef.current.getDeviceId();
          setDeviceId(id);
          if (typeof window !== "undefined") {
            window.localStorage.setItem("deviceId", id);
          }
          setDeviceIdLoading(false);
        } else {
          setDeviceId(id);
        }

        const existingToken = getCookie("deviceToken");
        const existingKey = getCookie("deviceEncryptionKey");
        if (existingToken && existingKey) {
          setDeviceToken(existingToken);
          setDeviceEncryptionKey(existingKey);
          setStatus("Ready. Sign in with Google to continue.");
          return;
        }

        setStatus("Creating device token...");
        const response = await fetch("/api/endpoints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "createDeviceToken", deviceId: id }),
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
        setStatus("Ready. Sign in with Google to continue.");
      } catch (error) {
        console.log("Device token setup failed:", error);
        setStatus("Failed to set up device token");
        setDeviceIdLoading(false);
      }
    };

    if (sdkReady) {
      void ensureDeviceToken();
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

  const postLoginFlow = async (userToken, encryptionKey) => {
    try {
      setStatus("Initializing user...");
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "initializeUser",
          userToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === 155106) {
          await loadWallets(userToken, { source: "alreadyInitialized" });
          return;
        }
        const errorMsg = data.code
          ? `[${data.code}] ${data.error || data.message}`
          : data.error || data.message;
        setStatus("Failed to initialize user: " + errorMsg);
        return;
      }

      const challengeIdFromApi = data.challengeId;
      if (!challengeIdFromApi) {
        setStatus("No challengeId returned");
        return;
      }

      setStatus("Creating wallet...");
      const sdk = sdkRef.current;
      if (!sdk) {
        setStatus("SDK not ready");
        return;
      }

      sdk.setAuthentication({ userToken, encryptionKey });
      sdk.execute(challengeIdFromApi, (error) => {
        if (error) {
          console.log("Execute challenge failed:", error);
          setStatus(
            "Failed to create wallet: " + (error?.message ?? "Unknown error"),
          );
          return;
        }
        setStatus("Loading wallet details...");
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await loadWallets(userToken, { source: "afterCreate" });
        })().catch((e) => {
          console.log("Post-execute follow-up failed:", e);
          setStatus("Wallet created, but failed to load wallet details.");
        });
      });
    } catch (err) {
      console.log("Post-login flow error:", err);
      setStatus("Failed: " + (err?.message ?? "Unknown error"));
    }
  };
  postLoginFlowRef.current = postLoginFlow;

  const refreshDeviceToken = async () => {
    const id =
      typeof window !== "undefined"
        ? window.localStorage.getItem("deviceId")
        : null;
    if (!id) {
      setStatus("Cannot refresh: no deviceId. Please reload the page.");
      return;
    }
    deleteCookie("deviceToken");
    deleteCookie("deviceEncryptionKey");
    setDeviceToken("");
    setDeviceEncryptionKey("");

    try {
      setStatus("Requesting new device token...");
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createDeviceToken", deviceId: id }),
      });
      const data = await response.json();

      if (!response.ok) {
        setStatus("Failed to refresh device token. Please reload the page.");
        return;
      }

      setDeviceToken(data.deviceToken);
      setDeviceEncryptionKey(data.deviceEncryptionKey);
      setCookie("deviceToken", data.deviceToken);
      setCookie("deviceEncryptionKey", data.deviceEncryptionKey);

      const sdk = sdkRef.current;
      if (sdk) {
        sdk.updateConfigs({
          appSettings: { appId },
          loginConfigs: {
            deviceToken: data.deviceToken,
            deviceEncryptionKey: data.deviceEncryptionKey,
            google: {
              clientId: googleClientId,
              redirectUri:
                typeof window !== "undefined" ? window.location.origin : "",
              selectAccountPrompt: true,
            },
          },
        });
      }

      setStatus("Device token refreshed. Please try again.");
    } catch (err) {
      console.log("Refresh device token failed:", err);
      setStatus("Failed to refresh device token. Please reload the page.");
    }
  };
  refreshDeviceTokenRef.current = refreshDeviceToken;

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

  const handleMint = async () => {
    const sdk = sdkRef.current;
    const wallet = wallets[0];

    if (!sdk) {
      setStatus("SDK not ready");
      return;
    }
    if (!loginResult?.userToken || !loginResult?.encryptionKey) {
      setStatus("Missing login credentials. Please login again.");
      return;
    }
    if (!wallet?.id) {
      setStatus("No wallet available. Create a wallet first.");
      return;
    }
    if (!contractAddress?.trim()) {
      setStatus("NEXT_PUBLIC_CONTRACT_ADDRESS is not set in .env.local.");
      return;
    }
    if (!mintReceiver?.trim()) {
      setStatus("Enter the receiver address.");
      return;
    }
    const amount = mintAmount?.trim();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setStatus("Enter a valid mint amount (positive number).");
      return;
    }

    setMintLoading(true);
    setStatus("Creating mint challenge...");

    try {
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createContractExecutionChallenge",
          userToken: loginResult.userToken,
          walletId: wallet.id,
          contractAddress: contractAddress.trim(),
          abiFunctionSignature: "mint(uint256,address)",
          abiParameters: [amount, mintReceiver.trim()],
          feeLevel: "MEDIUM",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.log("Create mint challenge failed:", data);
        setStatus(
          "Failed to create mint challenge: " +
            (data.error || data.message || JSON.stringify(data)),
        );
        setMintLoading(false);
        return;
      }

      const mintChallengeId = data.challengeId;
      if (!mintChallengeId) {
        setStatus("No challengeId returned from API");
        setMintLoading(false);
        return;
      }

      sdk.setAuthentication({
        userToken: loginResult.userToken,
        encryptionKey: loginResult.encryptionKey,
      });

      setStatus("Approve the mint in the SDK...");

      sdk.execute(mintChallengeId, (error) => {
        setMintLoading(false);

        if (error) {
          console.log("Mint execute failed:", error);
          setStatus(
            "Mint failed: " + (error?.message ?? "User denied or transaction failed"),
          );
          return;
        }

        setStatus("Mint transaction submitted successfully.");
      });
    } catch (err) {
      console.log("Mint error:", err);
      setStatus("Mint failed: " + (err?.message ?? "Network or server error"));
      setMintLoading(false);
    }
  };

  const primaryWallet = wallets[0];

  return (
    <main>
      <div style={{ width: "50%", margin: "0 auto" }}>
        <h1>Create a user wallet with Google social login</h1>
        <p>Sign in with Google to create or access your wallet. Device token and wallet setup run automatically.</p>

        {!primaryWallet && (
          <div>
            <button
              onClick={handleLoginWithGoogle}
              style={{ margin: "6px", padding: "10px 20px", fontSize: "16px" }}
              disabled={!sdkReady || !deviceToken || !deviceEncryptionKey || deviceIdLoading}
            >
              Login with Google
            </button>
          </div>
        )}

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

        {primaryWallet && (
          <div style={{ marginTop: "24px", padding: "16px", border: "1px solid #ccc", borderRadius: "8px" }}>
            <h2>Mint tokens</h2>
            <p style={{ marginBottom: "12px", fontSize: "14px", color: "#555" }}>
              Call <code>mint(uint256 _amount, address _receiver)</code> on your token contract.
            </p>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
                Receiver address
              </label>
              <input
                type="text"
                value={mintReceiver}
                onChange={(e) => setMintReceiver(e.target.value)}
                placeholder="0x..."
                style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
                Amount
              </label>
              <input
                type="text"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                placeholder="e.g. 1000"
                style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
              />
            </div>
            <button
              onClick={handleMint}
              disabled={mintLoading || !contractAddress?.trim() || !mintReceiver?.trim() || !mintAmount?.trim()}
              style={{ marginTop: "8px", padding: "8px 16px" }}
            >
              {mintLoading ? "Minting…" : "Mint"}
            </button>
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