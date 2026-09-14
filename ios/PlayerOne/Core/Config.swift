import Foundation

/// Every constant the app needs to find its backend, its sibling processes, and
/// itself.
///
/// The Supabase URL and publishable key are the same pair the web bundle ships
/// (see `src/lib/db.js`). That is not an oversight. Since migration 003 the
/// publishable key grants nothing on its own — RLS admits `authenticated` and
/// nobody else, so the key routes a request to the right project and stops
/// there. Baking it in is what lets the app be signed-in-ready on first launch
/// instead of asking for a URL nobody remembers.
///
/// What is NOT here, and must never be: the service role key, the Binance pair,
/// or any model provider key. Those live in GitHub Secrets and Vercel env vars
/// and no client — browser or phone — has ever seen one.
enum Config {

    // MARK: - Supabase

    static let supabaseURL = URL(string: "https://xroynvkzephebhcztvfo.supabase.co")!
    static let supabaseAnonKey = "sb_publishable_OVCd6KhOHNVYz1a9vCisbg_OsIF0uhy"

    static var restURL: URL { supabaseURL.appendingPathComponent("rest/v1") }
    static var authURL: URL { supabaseURL.appendingPathComponent("auth/v1") }

    // MARK: - Identity

    /// Must match the `com.apple.security.application-groups` entitlement on
    /// BOTH targets. The app writes the widget snapshot here and the widget
    /// reads it; a mismatch is silent — the widget simply renders its
    /// placeholder forever, which reads as "widgets are broken" rather than
    /// "the two targets are not in the same group".
    static let appGroup = "group.com.neel.playerone"

    /// Keychain access group for the session. Sharing it is what lets the
    /// widget's interactive intents write to Supabase without a second login.
    /// Xcode prefixes this with the team ID at build time via
    /// `$(AppIdentifierPrefix)`, so the literal here is the suffix only.
    static let keychainGroup = "com.neel.playerone.shared"

    static let urlScheme = "playerone"

    /// Where Supabase sends the browser back after a Google sign-in. This exact
    /// string must also be listed in Supabase → Authentication → URL
    /// Configuration → Redirect URLs, or the provider returns
    /// `redirect_to is not allowed` and the sheet closes on an error page.
    static var oauthRedirect: String { "\(urlScheme)://auth-callback" }

    // MARK: - Behaviour

    /// How often a foreground screen re-reads its collection. 45s matches the
    /// web app's poll in `src/lib/hooks.js`; the two clients should not
    /// disagree about how stale "live" is allowed to be.
    static let pollInterval: TimeInterval = 45

    /// Background refresh identifier, also listed under
    /// `BGTaskSchedulerPermittedIdentifiers` in Info.plist. iOS silently
    /// refuses to schedule a task whose identifier is missing from that array.
    static let bgRefreshTaskID = "com.neel.playerone.refresh"
    static let bgHealthTaskID = "com.neel.playerone.health"
}
