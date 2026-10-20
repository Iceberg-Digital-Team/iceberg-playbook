export function SiteCredit({ centered = false }: { centered?: boolean }) {
  return (
    <div className={`site-credit${centered ? ' site-credit--centered' : ''}`}>
      <img src="/iceberg-icon.png" alt="" aria-hidden="true" className="site-credit-icon" />
      <span>Developed within Iceberg X by{' '}
        <a href="https://x.iceberg-digital.co.uk/x/010" target="_blank" rel="noopener noreferrer">Cube #10</a>
        {' '}and{' '}
        <a href="https://x.iceberg-digital.co.uk/x/049" target="_blank" rel="noopener noreferrer">Cube #49</a>.</span>
    </div>
  );
}
