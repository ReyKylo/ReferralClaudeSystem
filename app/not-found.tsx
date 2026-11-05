import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="center-page">
      <section className="card card-pad grid" style={{ maxWidth: 480 }}>
        <h1>Halaman tidak ditemukan</h1>
        <p className="muted">Alamat ini tidak ada di portal referral.</p>
        <div><Link className="btn btn-1" href="/">Kembali ke Beranda</Link></div>
      </section>
    </div>
  );
}
