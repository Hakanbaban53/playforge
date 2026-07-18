import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { signInWithRedirect, getRedirectResult, onAuthStateChanged, User } from 'firebase/auth';
import { FirebaseService } from '../../core/services/firebase.service';

@Component({
  selector: 'app-oauth-callback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="oauth-container">
      <div class="oauth-card">
        <div class="logo">PlayForge</div>

        <div *ngIf="status() === 'login-prompt'" class="status-box login-prompt">
          <div class="icon google-icon">G</div>
          <h3>PlayForge'a Giriş Yapın</h3>
          <p>Uygulamaya güvenli bir şekilde bağlanmak için Google hesabınızla giriş yapın.</p>
          <button (click)="tryLogin()" class="btn-primary">Google ile Giriş Yap</button>
        </div>

        <div *ngIf="status() === 'loading'" class="status-box">
          <div class="spinner"></div>
          <p>Oturum açılıyor, lütfen bekleyin...</p>
        </div>

        <div *ngIf="status() === 'success'" class="status-box success">
          <div class="icon">✓</div>
          <h3>Giriş Başarılı!</h3>
          <p>Uygulamaya geri yönlendiriliyorsunuz...</p>
          <a [href]="deepLinkUrl()" class="btn-primary">Uygulamayı Aç</a>
          <p class="hint">Eğer uygulama otomatik olarak açılmazsa yukarıdaki butona tıklayabilirsiniz.</p>
        </div>

        <div *ngIf="status() === 'error'" class="status-box error">
          <div class="icon">✕</div>
          <h3>Giriş Başarısız</h3>
          <p class="error-msg">{{ errorMessage() }}</p>
          <button (click)="tryLogin()" class="btn-primary">Tekrar Dene</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .oauth-container {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #0f172a;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f1f5f9;
      padding: 20px;
    }
    .oauth-card {
      background: #1e293b;
      border: 1px solid #334155;
      padding: 40px;
      border-radius: 16px;
      width: 100%;
      max-width: 440px;
      text-align: center;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    }
    .logo {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.025em;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 30px;
    }
    .status-box {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .spinner {
      border: 3px solid #334155;
      border-top: 3px solid #38bdf8;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin-bottom: 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .icon {
      font-size: 40px;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .google-icon {
      background: rgba(59, 130, 246, 0.1);
      color: #3b82f6;
      border: 1px solid rgba(59, 130, 246, 0.2);
      font-weight: bold;
    }
    .success .icon {
      background: rgba(16, 185, 129, 0.1);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .error .icon {
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    h3 {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 10px 0;
    }
    p {
      color: #94a3b8;
      margin: 0 0 20px 0;
      font-size: 15px;
      line-height: 1.5;
    }
    .error-msg {
      color: #fca5a5;
    }
    .hint {
      font-size: 12px;
      margin-top: 15px;
      color: #64748b;
    }
    .btn-primary {
      display: inline-block;
      background: #3b82f6;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: background 0.2s;
      width: 100%;
      box-sizing: border-box;
    }
    .btn-primary:hover {
      background: #2563eb;
    }
  `]
})
export class OAuthCallbackPage implements OnInit {
  private readonly fb = inject(FirebaseService);

  private static readonly REDIRECT_FLAG = 'playforge_oauth_redirect';

  readonly status = signal<'login-prompt' | 'loading' | 'success' | 'error'>('login-prompt');
  readonly errorMessage = signal<string>('');
  readonly deepLinkUrl = signal<string>('');

  private handled = false;

  async ngOnInit(): Promise<void> {
    const auth = this.fb.auth;
    if (!auth) {
      this.status.set('error');
      this.errorMessage.set('Firebase yapılandırması bulunamadı.');
      return;
    }

    const redirectInProgress = sessionStorage.getItem(OAuthCallbackPage.REDIRECT_FLAG);

    if (redirectInProgress) {
      // We are returning from a Google redirect — process the result.
      this.status.set('loading');
      sessionStorage.removeItem(OAuthCallbackPage.REDIRECT_FLAG);

      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          await this.handleUser(result.user);
          return;
        }
      } catch (err: any) {
        console.error('[OAuthCallback] Redirect result error:', err);
        this.status.set('error');
        this.errorMessage.set(err.message || 'Giriş işlemi başarısız.');
        return;
      }

      // getRedirectResult returned null — Firebase may still be hydrating.
      // Fall through to onAuthStateChanged to catch the user.
    }

    // Listen for auth state. Handles two cases:
    //   1. User already has an active session → send token immediately
    //   2. Redirect result was null but Firebase hydrates the user shortly after
    onAuthStateChanged(auth, (user) => {
      if (user && !this.handled) {
        void this.handleUser(user);
      } else if (!user && this.status() !== 'error' && this.status() !== 'success') {
        this.status.set('login-prompt');
      }
    });
  }

  /**
   * Triggered ONLY by user click.
   * Sets a sessionStorage flag BEFORE redirecting so we know,
   * on return, that we intentionally left. Without the flag
   * the page just shows the login button — no auto-redirect, no loop.
   */
  async tryLogin(): Promise<void> {
    const auth = this.fb.auth;
    if (!auth) return;

    this.status.set('loading');
    this.errorMessage.set('');

    try {
      sessionStorage.setItem(OAuthCallbackPage.REDIRECT_FLAG, 'true');
      await signInWithRedirect(auth, this.fb.googleProvider);
      // Page will navigate away — this line is never reached.
    } catch (err: any) {
      console.error('[OAuthCallback] Redirect initiation failed:', err);
      sessionStorage.removeItem(OAuthCallbackPage.REDIRECT_FLAG);
      this.status.set('error');
      this.errorMessage.set(err.message || 'Giriş işlemi başlatılamadı.');
    }
  }

  private async handleUser(user: User): Promise<void> {
    if (this.handled) return;
    this.handled = true;

    try {
      const idToken = await user.getIdToken();
      const url = `playforge://oauth?token=${idToken}`;
      this.deepLinkUrl.set(url);
      this.status.set('success');

      // Attempt to open the deep link
      window.location.href = url;
    } catch (err: any) {
      console.error('[OAuthCallback] Failed to get ID token:', err);
      this.handled = false;
      this.status.set('error');
      this.errorMessage.set('Token alma işlemi başarısız.');
    }
  }
}
