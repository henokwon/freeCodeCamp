import { of } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { navigate } from 'gatsby';
import { challengeTypes } from '@freecodecamp/shared/config/challenge-types';
import { createFlashMessage } from '../../../components/Flash/redux';
import { standardErrorMessage } from '../../../utils/error-messages';
import { post } from '../../../utils/ajax';
import {
  submitComplete,
  setIsProcessing,
  updateFailed
} from '../../../redux/actions';
import completionEpic from './completion-epic';
import {
  closeModal,
  setIsAdvancing,
  submitChallenge,
  submitChallengeComplete,
  submitChallengeError,
  updateSolutionFormValues
} from './actions';

vi.mock('gatsby', () => ({ navigate: vi.fn() }));
vi.mock('../../../utils/ajax', () => ({
  post: vi.fn(),
  mapFilesToChallengeFiles: files => files
}));
vi.mock('../../../components/Flash/redux', () => ({
  createFlashMessage: vi.fn(payload => ({
    type: 'createFlashMessage',
    payload
  }))
}));
vi.mock('../../../redux/selectors', () => ({
  isSignedInSelector: state => !!state.app.user.sessionUser,
  userSelector: state => state.app.user.sessionUser
}));
vi.mock('./selectors', () => ({
  challengeFilesSelector: state => state.challenge.challengeFiles,
  challengeMetaSelector: state => state.challenge.challengeMeta,
  challengeTestsSelector: state => state.challenge.challengeTests,
  userCompletedExamSelector: state => state.challenge.userCompletedExam,
  projectFormValuesSelector: state => state.challenge.projectFormValues,
  isBlockNewlyCompletedSelector: () => false,
  isModuleNewlyCompletedSelector: () => false
}));

function createState(challengeType = challengeTypes.html) {
  return {
    app: { user: { sessionUser: { username: 'camper' } } },
    challenge: {
      challengeMeta: {
        id: 'challenge-id',
        challengeType,
        isLastChallengeInBlock: false,
        nextChallengePath: '/learn/next-challenge',
        blockHashSlug: '/learn/current-block',
        superBlock: 'responsive-web-design'
      },
      challengeTests: [{ pass: true }],
      challengeFiles: [],
      projectFormValues: {
        solution: 'https://example.com/project',
        githubLink: 'https://github.com/camper/project'
      }
    }
  };
}

function successResponse() {
  return {
    response: new Response(null, { status: 200 }),
    data: { type: 'success', savedChallenges: [] }
  };
}

function submit(state = createState()) {
  return completionEpic(of(submitChallenge()), { value: state })
    .pipe(toArray())
    .toPromise();
}

describe('completionEpic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(post).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves the learner on the challenge when the network request fails', async () => {
    vi.mocked(post).mockRejectedValue(new Error('Offline'));

    const actions = await submit();

    expect(navigate).not.toHaveBeenCalled();
    expect(actions).toContainEqual(submitChallengeError());
    expect(actions).not.toContainEqual(closeModal('completion'));
    expect(actions).not.toContainEqual(setIsAdvancing(true));
    expect(actions).toContainEqual(setIsProcessing(false));
  });

  it('dispatches an error message after retries are exhausted', async () => {
    vi.mocked(post).mockRejectedValue(new Error('Offline'));

    const actions = await submit();

    expect(actions).toContainEqual(createFlashMessage(standardErrorMessage));
    expect(actions).not.toContainEqual(submitChallengeComplete());
  });

  it('makes a fresh request when retrying a transient network failure', async () => {
    vi.mocked(post)
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValueOnce(successResponse());

    const actions = await submit();

    expect(post).toHaveBeenCalledTimes(2);
    expect(actions).toContainEqual(submitChallengeComplete());
    expect(actions.some(action => action.type === updateFailed().type)).toBe(
      false
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/learn/next-challenge');
  });

  it('keeps server-rejected submissions open and displays the server message', async () => {
    const data = { type: 'error', message: 'flash.generic-error' };
    vi.mocked(post).mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data
    });

    const actions = await submit();

    expect(post).toHaveBeenCalledTimes(1);
    expect(actions).toContainEqual(createFlashMessage(data));
    expect(actions).toContainEqual(submitChallengeError());
    expect(actions).not.toContainEqual(closeModal('completion'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('displays a fallback when a server error has no message', async () => {
    vi.mocked(post).mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: { type: 'error' }
    });

    const actions = await submit();

    expect(actions).toContainEqual(createFlashMessage(standardErrorMessage));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not mark a failed HTTP response as a completed challenge', async () => {
    vi.mocked(post).mockResolvedValue({
      response: new Response(null, { status: 503 }),
      data: { error: 'Service Unavailable' }
    });

    const actions = await submit();

    expect(actions.some(action => action.type === submitComplete().type)).toBe(
      false
    );
    expect(actions).toContainEqual(submitChallengeError());
    expect(actions).toContainEqual(createFlashMessage(standardErrorMessage));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('preserves project links when a project submission fails', async () => {
    vi.mocked(post).mockRejectedValue(new Error('Offline'));

    const actions = await submit(createState(challengeTypes.frontEndProject));

    expect(actions).not.toContainEqual(updateSolutionFormValues({}));
    expect(actions).not.toContainEqual(closeModal('completion'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clears project links after a successful submission', async () => {
    vi.mocked(post).mockResolvedValue(successResponse());

    const actions = await submit(createState(challengeTypes.frontEndProject));

    expect(actions).toContainEqual(updateSolutionFormValues({}));
    expect(actions).toContainEqual(closeModal('completion'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/learn/next-challenge');
  });

  it('advances exactly once after a successful signed-in submission', async () => {
    vi.mocked(post).mockResolvedValue(successResponse());

    const actions = await submit();

    expect(actions).toContainEqual(submitChallengeComplete());
    expect(actions).toContainEqual(setIsAdvancing(true));
    expect(actions).toContainEqual(closeModal('completion'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/learn/next-challenge');
  });

  it('advances signed-out learners without making an API request', async () => {
    const state = createState();
    state.app.user.sessionUser = null;

    const actions = await submit(state);

    expect(post).not.toHaveBeenCalled();
    expect(actions).toContainEqual(submitChallengeComplete());
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/learn/next-challenge');
  });

  it('navigates to the block after its last challenge', async () => {
    vi.mocked(post).mockResolvedValue(successResponse());
    const state = createState();
    state.challenge.challengeMeta.isLastChallengeInBlock = true;

    const actions = await submit(state);

    expect(actions).toContainEqual(setIsAdvancing(false));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/learn/current-block');
  });

  it('does not advance when the challenge tests have not passed', async () => {
    const state = createState();
    state.challenge.challengeTests = [{ pass: false }];

    const actions = await submit(state);

    expect(post).not.toHaveBeenCalled();
    expect(actions).not.toContainEqual(closeModal('completion'));
    expect(actions).not.toContainEqual(setIsAdvancing(true));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps exam results on the current page after successful submission', async () => {
    vi.mocked(post).mockResolvedValue(successResponse());

    const actions = await submit(createState(challengeTypes.exam));

    expect(actions).toContainEqual(submitChallengeComplete());
    expect(navigate).not.toHaveBeenCalled();
  });
});
