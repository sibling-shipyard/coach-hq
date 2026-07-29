/**
 * Shared header for the sign-in/setup flow (Setup.tsx, AuthError.tsx, Onboarding.tsx,
 * RepoDataGate.tsx's non-content states). `action` is the one thing that varies per screen -
 * "Cancel" pre-session, "Sign out" once there's a session to clear.
 */
interface AuthPageHeaderProps {
  action?: { label: string; href: string };
}

export function AuthPageHeader({ action }: AuthPageHeaderProps) {
  return (
    <header className="auth-page-header">
      <div className="auth-page-header__inner">
        <span className="auth-page-header__brand">COACH PHELPS</span>
        <span className="auth-page-header__beta">PRIVATE BETA</span>
        {action && (
          <a href={action.href} className="auth-page-header__action">
            {action.label}
          </a>
        )}
      </div>
    </header>
  );
}
