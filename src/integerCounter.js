export default function integerCounter() {
  let i = 0;

  function incrementAndGet() {
    i = i + 1;
    return i;
  }

  function decrementAndGet() {
    i = i - 1;
    return i;
  }

  function getAndIncrement() {
    const tmp = i;
    i = i + 1;
    return tmp;
  }

  function getAndDecrement() {
    const tmp = i;
    i = i - 1;
    return tmp;
  }

  function get() {
    return i;
  }

  return {
    incrementAndGet,
    decrementAndGet,
    getAndIncrement,
    getAndDecrement,
    get
  };
}
