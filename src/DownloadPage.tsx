
import "./DownloadPage.css";

export default function DownloadPage() {
  return (
    <div className="download-page">
      <header className="download-header">
        <a href="/" className="download-brand">CampusCart</a>
        <span className="download-badge">ANDROID APP</span>
      </header>

      <main className="download-hero">
        <p className="download-eyebrow">YOUR CAMPUS MARKETPLACE</p>

        <div className="download-visual">
          <div className="download-phone">
            <div className="phone-notch" />
            <div className="phone-content">
              <span className="phone-logo">C</span>
              <strong>CampusCart</strong>
              <p>Good finds, closer to campus.</p>
              <div className="phone-item">Books &amp; Uniforms</div>
              <div className="phone-item">Student Marketplace</div>
            </div>
          </div>
        </div>

        <h1>Your Campus Marketplace, Anytime.</h1>
        <p className="download-description">
          Buy, sell, and connect with fellow students through CampusCart.
          Your campus marketplace is now available on Android.
        </p>

        <a
          className="download-button"
          href="/downloads/CampusCart.apk"
          download="CampusCart.apk"
        >
          DOWNLOAD CAMPUSCART
        </a>

        <p className="download-status">Free &amp; Ready to Install · Android APK</p>

        <section className="install-section">
          <p className="download-eyebrow">GET STARTED</p>
          <h2>How to install</h2>

          <div className="install-steps">
            <article>
              <span>01</span>
              <div>
                <h3>Download the APK</h3>
                <p>Tap the download button above to get the CampusCart installer.</p>
              </div>
            </article>

            <article>
              <span>02</span>
              <div>
                <h3>Allow installation</h3>
                <p>If prompted, allow your browser to install apps from this source.</p>
              </div>
            </article>

            <article>
              <span>03</span>
              <div>
                <h3>Install and enjoy</h3>
                <p>Open the downloaded file, install CampusCart, and start exploring.</p>
              </div>
            </article>
          </div>
        </section>

        <a href="/" className="back-to-campus">← Back to CampusCart</a>
      </main>

      <footer className="download-footer">
        © {new Date().getFullYear()} CampusCart · Your campus, your marketplace.
      </footer>
    </div>
  );
}
