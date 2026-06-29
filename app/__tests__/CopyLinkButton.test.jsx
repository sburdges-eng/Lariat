// @ts-nocheck - pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CopyLinkButton from '../beo/_components/CopyLinkButton';

test('copies the url and shows confirmation', async () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CopyLinkButton url="https://x/beo/share/abc" />);
  await userEvent.click(screen.getByRole('button', { name: /copy/i }));
  expect(writeText).toHaveBeenCalledWith('https://x/beo/share/abc');
  expect(await screen.findByText(/copied/i)).toBeInTheDocument();
});

test('resolves a relative url to an absolute url before copying', async () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CopyLinkButton url="/beo/share/abc" />);
  await userEvent.click(screen.getByRole('button', { name: /copy/i }));
  // jsdom default origin is http://localhost
  expect(writeText).toHaveBeenCalledWith('http://localhost/beo/share/abc');
});
