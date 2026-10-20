"""Album similarity after Logan & Salomon (2001), "A Music Similarity Function
Based on Signal Analysis":

  1. ~23 ms frames -> MFCCs (c0, the loudness term, dropped)
  2. per song: k-means (K=16) over its frames -> signature of
     {cluster mean, diagonal covariance, weight = share of frames}
  3. ground distance between clusters = symmetric KL divergence of Gaussians
  4. distance between signatures = Earth Mover's Distance

Albums ("data by album"): an album's signature is the union of its tracks'
clusters, each track weighted equally, so EMD compares whole-album timbre
distributions. Writes data/similarity.json and data/similarity_*.npy.
"""
import subprocess
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import ot
from sklearn.cluster import KMeans

from common import DATA, load, save

SR, N_FFT, HOP = 22050, 512, 256
N_MFCC, K = 20, 16
VAR_FLOOR = 1e-3
FEATURES = DATA / "features"


def decode(path):
    pcm = subprocess.run(["ffmpeg", "-v", "quiet", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32)


def feature_path(preview):
    return (FEATURES / preview["file"].replace("audio/", "", 1)).with_suffix(".npz")


def signature(preview):
    out = feature_path(preview)
    if out.exists():
        return
    import librosa
    y = decode(DATA / preview["file"])
    mfcc = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=N_MFCC, n_fft=N_FFT, hop_length=HOP)[1:].T  # frames x 19
    rms = librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]
    mfcc = mfcc[rms > 1e-4]  # skip digital silence (fade-ins/outs of previews)
    if len(mfcc) < K * 20:  # too little audio to cluster (e.g. near-silent spoken interludes)
        print(f"  skipped (only {len(mfcc)} frames): #{preview['album_rank']} {preview['name']}")
        return
    km = KMeans(K, n_init=3, random_state=0).fit(mfcc)
    means = km.cluster_centers_
    var = np.stack([mfcc[km.labels_ == k].var(0) if (km.labels_ == k).sum() > 1 else np.ones(mfcc.shape[1])
                    for k in range(K)])
    w = np.bincount(km.labels_, minlength=K) / len(km.labels_)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, means=means, var=np.maximum(var, VAR_FLOOR), w=w)


def kl_cost(ma, va, mb, vb):
    """Symmetric KL between every pair of diagonal Gaussians -> (len(a), len(b))."""
    va, vb = va[:, None, :], vb[None, :, :]
    d2 = (ma[:, None, :] - mb[None, :, :]) ** 2
    return 0.5 * (va / vb + vb / va - 2 + d2 * (1 / va + 1 / vb)).sum(-1)


def album_signature(files):
    sigs = [np.load(f) for f in files]
    means = np.concatenate([s["means"] for s in sigs])
    var = np.concatenate([s["var"] for s in sigs])
    w = np.concatenate([s["w"] / len(sigs) for s in sigs])
    return means, var, w


def emd_row(args):
    i, sigs = args
    ma, va, wa = sigs[i]
    row = np.zeros(len(sigs))
    for j in range(i + 1, len(sigs)):
        mb_, vb, wb = sigs[j]
        row[j] = ot.emd2(wa, wb, kl_cost(ma, va, mb_, vb), numItermax=1_000_000)
    return i, row


def main():
    albums = load("albums.json")
    previews = load("previews.json")
    with ProcessPoolExecutor() as pool:
        list(pool.map(signature, previews, chunksize=8))
    print(f"signatures for {len(previews)} previews")

    ranks, sigs = [], []
    for a in albums:
        files = [f for p in previews if p["album_rank"] == a["rank"] and (f := feature_path(p)).exists()]
        if files:
            ranks.append(a["rank"])
            sigs.append(album_signature(files))
    n = len(ranks)
    cached = DATA / "similarity_distance.npz"
    if cached.exists() and np.load(cached)["ranks"].tolist() == ranks:
        D = np.load(cached)["D"]
    else:
        D = np.zeros((n, n))
        with ProcessPoolExecutor() as pool:
            for i, row in pool.map(emd_row, [(i, sigs) for i in range(n)]):
                D[i] = row
        D = D + D.T
        np.savez(cached, D=D, ranks=ranks)
    sigma = np.median(D[np.triu_indices(n, 1)])
    S = np.exp(-D / sigma)
    S_mp = mutual_proximity(D)

    save("similarity.json", {
        "method": "Logan & Salomon 2001: MFCC k-means signatures (K=16) + EMD with symmetric-KL ground distance; "
                  "album signature = union of track signatures",
        "ranks": ranks, "sigma": sigma,
        "distance": np.round(D, 4).tolist(),
        "similarity_raw": np.round(S, 4).tolist(),  # exp(-EMD / median EMD)
        "similarity_mp": np.round(S_mp, 4).tolist(),  # empirical mutual proximity (Schnitzer et al. 2012)
        "checks": {"raw": checks(S, ranks, albums), "mp": checks(S_mp, ranks, albums)},
    })
    for name in ("raw", "mp"):
        c = checks(S if name == "raw" else S_mp, ranks, albums)
        print(f"{name:>3}: same-artist median rank {c['same_artist_median_rank']} of {n - 1} (chance ~{(n - 1) // 2}) | "
              f"genre match in top-5 {c['top5_genre_share']} (random {c['random_genre_share']}) | "
              f"max hub {c['max_top10_count']} | never in a top-10 {c['never_in_top10']}")
    print(f"{n}x{n} album matrix -> data/similarity.json")


def mutual_proximity(D):
    """Empirical mutual proximity: share of other albums that are farther than d(x,y)
    from *both* x and y. Down-weights hubs, which are near everything (Schnitzer et al. 2012)."""
    n = len(D)
    S = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            others = np.ones(n, bool)
            others[[i, j]] = False
            S[i, j] = S[j, i] = ((D[i, others] > D[i, j]) & (D[j, others] > D[i, j])).sum() / (n - 2)
    return S


def checks(S, ranks, albums):
    """Same-artist neighbour rank, genre agreement and hubness for a similarity matrix."""
    n = len(ranks)
    by_rank = {a["rank"]: a for a in albums}
    artist = [by_rank[r]["artist"].lower() for r in ranks]
    genres = [set(by_rank[r]["genres"]) for r in ranks]
    order = np.argsort(-(S - 2 * np.eye(n)), axis=1)[:, : n - 1]  # neighbours, nearest first, self excluded
    pos = [k + 1 for i in range(n) for k, j in enumerate(order[i]) if artist[j] == artist[i]]
    top5 = np.mean([bool(genres[i] & genres[j]) for i in range(n) for j in order[i, :5]])
    rand = np.mean([bool(genres[i] & genres[j]) for i in range(n) for j in range(n) if i != j])
    hubs = np.bincount(order[:, :10].ravel(), minlength=n)
    return {"same_artist_median_rank": float(np.median(pos)), "top5_genre_share": round(float(top5), 3),
            "random_genre_share": round(float(rand), 3), "max_top10_count": int(hubs.max()),
            "never_in_top10": int((hubs == 0).sum())}


if __name__ == "__main__":
    main()
