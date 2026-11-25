import { retry } from 'rxjs/operators';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { post } from '../../../utils/ajax';
import postUpdate$ from './post-update';

vi.mock('../../../utils/ajax', () => ({ post: vi.fn<typeof post>() }));

describe('postUpdate$', () => {
  const update = { endpoint: '/challenge-completed', payload: { id: 'id' } };

  beforeEach(() => {
    vi.mocked(post).mockReset();
  });

  it('starts a request only when subscribed', async () => {
    const result = {
      response: new Response(null, { status: 200 }),
      data: undefined
    };
    vi.mocked(post).mockResolvedValue(result);

    const update$ = postUpdate$(update);

    expect(post).not.toHaveBeenCalled();
    await expect(update$.toPromise()).resolves.toEqual(result);
    expect(post).toHaveBeenCalledExactlyOnceWith(
      update.endpoint,
      update.payload
    );
  });

  it('creates a new request for each retry', async () => {
    const result = {
      response: new Response(null, { status: 200 }),
      data: undefined
    };
    vi.mocked(post)
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValueOnce(result);

    await expect(
      postUpdate$(update).pipe(retry(3)).toPromise()
    ).resolves.toEqual(result);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('stops after the configured number of retries', async () => {
    const error = new Error('Offline');
    vi.mocked(post).mockRejectedValue(error);

    await expect(postUpdate$(update).pipe(retry(3)).toPromise()).rejects.toBe(
      error
    );
    expect(post).toHaveBeenCalledTimes(4);
  });
});
