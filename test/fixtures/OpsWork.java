// Work in operations, for a recording: two threads running a job in rounds, one operation each, and an
// asynchronous operation worked on by a third thread. Compiled and run with the jar of jfr-web (jfrweb.ops) on
// the class path; it records itself, with the operation events enabled, and writes ops.jfr.
import java.nio.file.Path;
import java.time.Duration;
import jdk.jfr.Recording;
import jfrweb.ops.Operation;
import jfrweb.ops.Operations;

public class OpsWork {
  static long spin(int n) {
    long x = 1;
    for (int i = 0; i < n; i++)
      x = x * 31 + i % 7;
    return x;
  }

  static long job(String name, int rounds) {
    long sink = 0;
    for (int i = 0; i < rounds; i++)
      try (Operation op = Operations.begin(name).detail("round " + i)) {
        sink += spin(3_000_000);
      }
    return sink;
  }

  public static void main(String[] args) throws Exception {
    Recording rec = new Recording();
    rec.enable("jdk.ExecutionSample").withPeriod(Duration.ofMillis(10));
    rec.enable("jfrweb.Operation");
    rec.enable("jfrweb.OperationSegment");
    rec.start();
    long[] sink = new long[3];
    Thread a = new Thread(() -> sink[0] = job("alpha", 30), "alpha-thread");
    Thread b = new Thread(() -> sink[1] = job("beta", 20), "beta-thread");
    a.start();
    b.start();
    // an asynchronous one, worked on by a thread in two segments
    Operation async = Operations.beginAsync("gamma").detail("async");
    Thread c = new Thread(async.wrap(() -> sink[2] = spin(300_000_000)), "gamma-thread");
    c.start();
    a.join();
    b.join();
    c.join();
    async.close();
    spin(50_000_000);
    rec.stop();
    rec.dump(Path.of("ops.jfr"));
    System.out.println(sink[0] + sink[1] + sink[2]);
  }
}
