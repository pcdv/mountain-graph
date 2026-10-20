import java.util.ArrayList;
import java.util.List;

/** A little work for a recording: a hot loop of arithmetic, and one that allocates. */
public class Work {
  static long spin(int n) {
    long x = 1;
    for (int i = 0; i < n; i++)
      x = x * 31 + i % 7;
    return x;
  }

  static int allocate(int n) {
    List<byte[]> kept = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      kept.add(new byte[1024 + i % 512]);
      if (kept.size() > 256)
        kept.clear();
    }
    return kept.size();
  }

  public static void main(String[] args) throws Exception {
    long end = System.nanoTime() + 2_500_000_000L;
    long sink = 0;
    while (System.nanoTime() < end) {
      sink += spin(2_000_000);
      sink += allocate(20_000);
    }
    Thread.sleep(200);
    System.out.println(sink);
  }
}
