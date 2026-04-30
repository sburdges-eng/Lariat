import { fireEvent, render, screen } from '@testing-library/react';
import AckButton from '../costing/pack-changes/AckButton';

const mockRefresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

describe('AckButton', () => {
  let promptSpy;

  beforeEach(() => {
    promptSpy = jest.spyOn(window, 'prompt');
    global.fetch = jest.fn();
    mockRefresh.mockClear();
  });

  afterEach(() => {
    promptSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('canceling the note prompt aborts acknowledgement', async () => {
    promptSpy.mockReturnValueOnce(null);

    render(<AckButton id={42} />);
    fireEvent.click(screen.getByRole('button', {
      name: /acknowledge pack-size change 42/i,
    }));

    await Promise.resolve();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {
      name: /acknowledge pack-size change 42/i,
    })).toHaveTextContent('Acknowledge');
  });
});
