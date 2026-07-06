import { Box, Button, Center, Flex, Heading, Input, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { useAuth } from '../contexts/auth-context'

export function AuthPage() {
    const { login, register } = useAuth()
    const [mode, setMode] = useState<'login' | 'register'>('login')
    const [username, setUsername] = useState('')
    const [displayName, setDisplayName] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    const isRegister = mode === 'register'

    const submit = async () => {
        setError('')
        setBusy(true)
        try {
            if (isRegister) await register({ username, password, displayName })
            else await login({ username, password })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Center
            height="100%"
            css={{ background: 'radial-gradient(1200px 520px at 50% -10%, #16332c, #0b141a)' }}
        >
            <Box
                width="360px"
                maxWidth="92vw"
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border.subtle"
                borderRadius="2xl"
                p="7"
                boxShadow="2xl"
            >
                <Flex align="center" gap="2.5">
                    <Text fontSize="2xl">💬</Text>
                    <Heading size="lg">ForgeChat</Heading>
                </Flex>
                <Text color="fg.muted" mt="1">
                    {isRegister ? 'Create your account' : 'Sign in to continue'}
                </Text>

                <Stack
                    gap="3"
                    mt="5"
                    as="form"
                    onSubmit={(e: React.FormEvent) => {
                        e.preventDefault()
                        void submit()
                    }}
                >
                    <Input
                        placeholder="Username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        maxLength={32}
                    />
                    {isRegister && (
                        <Input
                            placeholder="Display name"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            maxLength={48}
                        />
                    )}
                    <Input
                        placeholder="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    <Button type="submit" colorPalette="green" loading={busy}>
                        {isRegister ? 'Sign up' : 'Log in'}
                    </Button>
                    {error && (
                        <Text color="danger.solid" fontSize="sm">
                            {error}
                        </Text>
                    )}
                </Stack>

                <Text color="fg.muted" textAlign="center" mt="4" fontSize="sm">
                    {isRegister ? 'Already have an account? ' : 'New here? '}
                    <Text
                        as="span"
                        color="fg.accent"
                        cursor="pointer"
                        onClick={() => {
                            setError('')
                            setMode(isRegister ? 'login' : 'register')
                        }}
                    >
                        {isRegister ? 'Log in' : 'Create an account'}
                    </Text>
                </Text>
            </Box>
        </Center>
    )
}
